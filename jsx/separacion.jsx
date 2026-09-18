/* Separación v3 - jsx/separacion.jsx (ES3-safe: sin Object.keys, sin map)
   SP_ping · SP_readSel · SP_spread (video+audio, pistas auto) · SP_restack (video+audio, trim comun)
   El Synchronize lo hace el usuario a mano: Cmd+A > Clip > Synchronize > Audio. */

function J(o) {
    var t = typeof o, k, i;
    if (o === null) return "null";
    if (t === "number") return (isNaN(o) || !isFinite(o)) ? "0" : String(o);
    if (t === "boolean") return String(o);
    if (t === "string") return '"' + o.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
                                       .replace(/\n/g, "\\n").replace(/\r/g, "") + '"';
    if (o instanceof Array) {
        var a = [];
        for (i = 0; i < o.length; i++) a.push(J(o[i]));
        return "[" + a.join(",") + "]";
    }
    var p = [];
    for (k in o) if (o.hasOwnProperty(k)) p.push('"' + k + '":' + J(o[k]));
    return "{" + p.join(",") + "}";
}

function getZeroSec(seq) {
    try {
        var z = Number(seq.zeroPoint.ticks) / 254016000000;
        return isNaN(z) ? 0 : z;
    } catch (e) { return 0; }
}

function mpOf(clip) {
    try { return clip.projectItem.getMediaPath(); } catch (e) { return ""; }
}

function SP_ping() {
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) return J({ ok: false, error: "No hay secuencia activa" });
        return J({ ok: true, seq: seq.name,
                   videoTracks: seq.videoTracks.numTracks,
                   audioTracks: seq.audioTracks.numTracks });
    } catch (e) { return J({ ok: false, error: String(e) }); }
}

function SP_readSel() {
    var res = { ok: false };
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) { res.error = "No hay secuencia activa"; return J(res); }
        res.ok = true;
        res.zeroSec = getZeroSec(seq);
        res.vt = seq.videoTracks.numTracks;
        var clips = [];
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var tr = seq.videoTracks[t];
            for (var c = 0; c < tr.clips.numItems; c++) {
                var cl = tr.clips[c];
                var sel = false;
                try { sel = cl.isSelected(); } catch (eS) {}
                if (sel) clips.push({ track: t, start: cl.start.seconds - res.zeroSec,
                    end: cl.end.seconds - res.zeroSec, name: cl.name, inSec: cl.inPoint.seconds, mp: mpOf(cl) });
            }
        }
        res.source = clips.length ? "seleccion" : "nada";
        if (!clips.length) res.error = "No hay clips seleccionados. Selecciona los clips que quieras separar/reunir.";
        res.clips = clips;
        res.count = clips.length;
        return J(res);
    } catch (e) { res.error = e.toString(); return J(res); }
}

/* busca clips de audio cuyo media+posicion coincida con la lista fuente */
function audioMatches(seq, srcList) {
    var out = [];
    for (var a = 0; a < seq.audioTracks.numTracks; a++) {
        var tr = seq.audioTracks[a];
        for (var c = 0; c < tr.clips.numItems; c++) {
            var cl = tr.clips[c];
            var mp = mpOf(cl);
            if (!mp) continue;
            for (var s = 0; s < srcList.length; s++) {
                if (mp === srcList[s].mp && Math.abs(cl.start.seconds - (srcList[s].start + getZeroSec(seq))) < 0.08) {
                    out.push({ track: a, start: cl.start.seconds, end: cl.end.seconds,
                               inSec: cl.inPoint.seconds, mp: mp, srcIdx: s });
                    break;
                }
            }
        }
    }
    return out;
}

/* quita de las pistas los clips (video y audio) que coincidan con la lista */
function removeSources(seq, srcList, errs) {
    var removed = 0, t, c, s, cl, mp;
    for (t = 0; t < seq.videoTracks.numTracks; t++) {
        var tv = seq.videoTracks[t];
        for (c = tv.clips.numItems - 1; c >= 0; c--) {
            cl = tv.clips[c];
            mp = mpOf(cl);
            for (s = 0; s < srcList.length; s++) {
                if (mp === srcList[s].mp && Math.abs(cl.start.seconds - (srcList[s].start + getZeroSec(seq))) < 0.08) {
                    try { cl.remove(false, false); removed++; } catch (eR) { errs.push("quitar V" + (t + 1) + ": " + eR); }
                    break;
                }
            }
        }
    }
    for (t = 0; t < seq.audioTracks.numTracks; t++) {
        var ta = seq.audioTracks[t];
        for (c = ta.clips.numItems - 1; c >= 0; c--) {
            cl = ta.clips[c];
            mp = mpOf(cl);
            for (s = 0; s < srcList.length; s++) {
                if (mp === srcList[s].mp && Math.abs(cl.start.seconds - (srcList[s].start + getZeroSec(seq))) < 0.08) {
                    try { cl.remove(false, false); removed++; } catch (eR2) { errs.push("quitar A" + (t + 1) + ": " + eR2); }
                    break;
                }
            }
        }
    }
    return removed;
}

function ensureTracks(seq, needV, needA, res) {
    try {
        while (seq.videoTracks.numTracks < needV) { seq.addVideoTrack(); res.addedTracks++; }
        while (seq.audioTracks.numTracks < needA) { seq.addAudioTrack(); res.addedTracks++; }
        return true;
    } catch (eT) {
        res.errors.push("No pude crear pistas (" + eT + "). Crea " + needV + "V/" + needA + "A a mano y reintenta.");
        return false;
    }
}

/* SPREAD: cada clip (video+audio) a su propia pareja de pistas, mismo instante */
function SP_spread() {
    var res = { ok: false, spread: 0, audio: 0, addedTracks: 0, errors: [] };
    function err(m) { res.errors.push(String(m)); }
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) { err("No hay secuencia activa"); return J(res); }
        var zero = getZeroSec(seq);
        var read = eval("(" + SP_readSel() + ")");
        if (!read.ok || !read.clips.length) { err("No hay clips (selecciona o usa V1)"); return J(res); }
        var clips = read.clips;

        if (!ensureTracks(seq, clips.length, clips.length, res)) { res.ok = false; return J(res); }

        var items = [], missing = [];
        for (var i = 0; i < clips.length; i++) {
            var it = null;
            if (clips[i].mp) {
                (function walk(bin) {
                    if (it) return;
                    var n = bin.children.numItems;
                    for (var q = 0; q < n; q++) {
                        var ch = bin.children[q];
                        if (ch.type === ProjectItemType.BIN) { walk(ch); continue; }
                        try { if (ch.getMediaPath() === clips[i].mp) { it = ch; return; } } catch (e) {}
                    }
                })(app.project.rootItem);
            }
            if (!it) missing.push(clips[i].name || ("clip " + (i + 1)));
            items.push(it);
        }
        if (missing.length) { err("No encuentro en el proyecto: " + missing.join(", ") + " (¿anidados?)"); return J(res); }

        removeSources(seq, clips, res.errors);

        for (var k = 0; k < clips.length; k++) {
            var c = clips[k], item = items[k];
            var dur = c.end - c.start;
            try {
                item.setInPoint(c.inSec, 4);
                item.setOutPoint(c.inSec + dur, 4);
                seq.videoTracks[k].overwriteClip(item, c.start + zero);
                res.spread++;
            } catch (eP) { err("video clip " + (k + 1) + ": " + eP); continue; }
            try {
                item.setInPoint(c.inSec, 4);
                item.setOutPoint(c.inSec + dur, 4);
                seq.audioTracks[k].overwriteClip(item, c.start + zero);
                res.audio++;
            } catch (eA) { err("audio clip " + (k + 1) + ": " + eA); }
            try { item.clearInPoint(4); } catch (e1) {}
            try { item.clearOutPoint(4); } catch (e2) {}
        }
        res.ok = res.spread > 0;
        return J(res);
    } catch (e) { res.errors.push("FATAL: " + e.toString() + " (linea " + e.line + ")"); return J(res); }
}

/* RE-STACK: agrupa video+audio, recorta a la zona comun y apila en cascada
   payload: { layout: "squashed" | "perdevice" } */
function SP_restack(optsJson) {
    var res = { ok: false, stacked: 0, audio: 0, addedTracks: 0, errors: [], trimmed: false };
    function err(m) { res.errors.push(String(m)); }
    var TOL = 0.05;
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) { err("No hay secuencia activa"); return J(res); }
        var zero = getZeroSec(seq);
        var opts = null;
        try { opts = eval("(" + optsJson + ")"); } catch (eO) {}
        var perDevice = !!(opts && opts.layout === "perdevice");

        // 1) recoger SOLO video seleccionado; audio = sus emparejados
        var vids = [], auds = [], t, c;
        for (t = 0; t < seq.videoTracks.numTracks; t++) {
            var tv = seq.videoTracks[t];
            for (c = 0; c < tv.clips.numItems; c++) {
                var cv = tv.clips[c];
                var sel = false;
                try { sel = cv.isSelected(); } catch (eS) {}
                if (sel) vids.push({ track: t, start: cv.start.seconds, end: cv.end.seconds,
                            inSec: cv.inPoint.seconds, mp: mpOf(cv), name: cv.name, aud: -1 });
            }
        }
        if (!vids.length) { err("No hay clips de video seleccionados. Selecciona los que quieras reunir."); return J(res); }
        for (t = 0; t < seq.audioTracks.numTracks; t++) {
            var ta = seq.audioTracks[t];
            for (c = 0; c < ta.clips.numItems; c++) {
                var ca = ta.clips[c];
                auds.push({ track: t, start: ca.start.seconds, end: ca.end.seconds,
                            inSec: ca.inPoint.seconds, mp: mpOf(ca), used: false });
            }
        }

        // 2) emparejar cada audio con el video del mismo media mas cercano en tiempo
        for (var a2 = 0; a2 < auds.length; a2++) {
            var best = -1, bestD = 1e9;
            for (var v2 = 0; v2 < vids.length; v2++) {
                if (vids[v2].aud >= 0) continue;
                if (auds[a2].mp && auds[a2].mp === vids[v2].mp) {
                    var d = Math.abs(auds[a2].start - vids[v2].start);
                    if (d < bestD) { bestD = d; best = v2; }
                }
            }
            if (best >= 0 && bestD < 30) { vids[best].aud = a2; auds[a2].used = true; }
        }

        // 3) zona comun (solape de todos los videos)
        var cs0 = vids[0].start, ce0 = vids[0].end;
        for (var v3 = 1; v3 < vids.length; v3++) {
            if (vids[v3].start > cs0) cs0 = vids[v3].start;
            if (vids[v3].end < ce0) ce0 = vids[v3].end;
        }
        var trim = (ce0 - cs0) > 0.2;
        res.trimmed = trim;
        var base = trim ? cs0 : vids[0].start;
        for (var v4 = 1; v4 < vids.length; v4++)
            if (!trim && vids[v4].start < base) base = vids[v4].start;
        if (!trim) err("Aviso: los clips no solapan; no recorto, solo apilo desde el mas temprano.");

        // 4) pistas necesarias
        var needV = vids.length, needA = 0;
        for (var v5 = 0; v5 < vids.length; v5++) if (vids[v5].aud >= 0) needA++;
        if (!ensureTracks(seq, needV, needA, res)) { res.ok = false; return J(res); }

        // 5) quitar SOLO los implicados (video seleccionado + audio emparejado)
        var srcAll = [];
        for (var v6 = 0; v6 < vids.length; v6++)
            srcAll.push({ mp: vids[v6].mp, start: vids[v6].start - zero });
        for (var a6 = 0; a6 < auds.length; a6++)
            if (auds[a6].used) srcAll.push({ mp: auds[a6].mp, start: auds[a6].start - zero });
        removeSources(seq, srcAll, res.errors);

        // 6) recolocar: unidad i -> pista i (squashed) o su pista original (perdevice)
        for (var u = 0; u < vids.length; u++) {
            var unit = vids[u];
            var dur = trim ? (ce0 - cs0) : (unit.end - unit.start);
            var vin = trim ? (unit.inSec + (base - unit.start)) : unit.inSec;
            var tV = perDevice ? unit.track : u;
            var item = null;
            if (unit.mp) {
                (function find2(bin) {
                    if (item) return;
                    var n = bin.children.numItems;
                    for (var q = 0; q < n; q++) {
                        var ch = bin.children[q];
                        if (ch.type === ProjectItemType.BIN) { find2(ch); continue; }
                        try { if (ch.getMediaPath() === unit.mp) { item = ch; return; } } catch (e) {}
                    }
                })(app.project.rootItem);
            }
            if (!item) { err("media no encontrado: " + (unit.name || u)); continue; }
            try {
                item.setInPoint(vin, 4);
                item.setOutPoint(vin + dur, 4);
                seq.videoTracks[tV].overwriteClip(item, base + zero);
                res.stacked++;
            } catch (eP2) { err("video " + (u + 1) + ": " + eP2); continue; }
            if (unit.aud >= 0) {
                var au = auds[unit.aud];
                var ain = trim ? (au.inSec + (base - au.start)) : au.inSec;
                var tA = perDevice ? au.track : u;
                try {
                    item.setInPoint(ain, 4);
                    item.setOutPoint(ain + dur, 4);
                    seq.audioTracks[tA].overwriteClip(item, base + zero);
                    res.audio++;
                } catch (eA2) { err("audio " + (u + 1) + ": " + eA2); }
            }
            try { item.clearInPoint(4); } catch (e1) {}
            try { item.clearOutPoint(4); } catch (e2) {}
        }
        res.ok = res.stacked > 0;
        return J(res);
    } catch (e) { res.errors.push("FATAL: " + e.toString() + " (linea " + e.line + ")"); return J(res); }
}

/* ---- v3.3: escala proporcional (XMP dims + Motion>Scale por nombre) ---- */
function SP_fitSelection(mode) {
    var res = { ok: false, scaled: 0, errors: [] };
    function err(m) { res.errors.push(String(m)); }
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) { err("No hay secuencia activa"); return J(res); }
        var W = 0, H = 0;
        try { W = seq.frameSizeHorizontal; H = seq.frameSizeVertical; } catch (eF) {}
        if (!W || !H) { err("No pude leer el tamano de fotograma de la secuencia"); return J(res); }

        var t, c;
        for (t = 0; t < seq.videoTracks.numTracks; t++) {
            var tr = seq.videoTracks[t];
            for (c = 0; c < tr.clips.numItems; c++) {
                var cl = tr.clips[c];
                var sel = false;
                try { sel = cl.isSelected(); } catch (eS) {}
                if (!sel) continue;
                var it = null;
                try { it = cl.projectItem; } catch (ePI) {}
                if (!it) { err(cl.name + ": sin projectItem"); continue; }

                var mw = 0, mh = 0, xmp = "";
                try { xmp = it.getProjectMetadata(); } catch (eX) { xmp = ""; }
                if (xmp) {
                    var m1 = xmp.match(/stDim:w>(\d+)</), m2 = xmp.match(/stDim:h>(\d+)</);
                    if (m1 && m2) { mw = parseInt(m1[1], 10); mh = parseInt(m2[1], 10); }
                    if (!mw) { m1 = xmp.match(/FrameSizeHorizontal>(\d+)</); m2 = xmp.match(/FrameSizeVertical>(\d+)</);
                               if (m1 && m2) { mw = parseInt(m1[1], 10); mh = parseInt(m2[1], 10); } }
                }
                if (!mw || !mh) {
                    try {
                        var fi = it.getFootageInterpretation();
                        if (fi && fi.frameSizeHorizontal) { mw = fi.frameSizeHorizontal; mh = fi.frameSizeVertical; }
                    } catch (eFI) {}
                }
                if (!mw || !mh) { err(cl.name + ": sin dimensiones del media"); continue; }

                var newScale = (mode === "height") ? (H / mh) * 100 : (W / mw) * 100;
                if (newScale < 1) newScale = 1;
                if (newScale > 20000) newScale = 20000;

                var applied = false;
                var comps = null;
                try { comps = cl.components; } catch (eC) { comps = null; }
                if (!comps) { err(cl.name + ": sin componentes (Motion)"); continue; }
                for (var ci = 0; ci < comps.numItems && !applied; ci++) {
                    var comp = comps[ci];
                    var dn = String(comp.displayName).toLowerCase();
                    if (dn.indexOf("motion") < 0 && dn.indexOf("movimiento") < 0) continue;
                    var props = comp.properties;
                    var uni = null, ph = null, pw = null;
                    for (var pi = 0; pi < props.numItems; pi++) {
                        var nm = String(props[pi].displayName).toLowerCase();
                        if (nm === "scale" || nm === "escala") uni = props[pi];
                        if (nm.indexOf("scale height") >= 0 || nm.indexOf("altura de escala") >= 0) ph = props[pi];
                        if (nm.indexOf("scale width") >= 0 || nm.indexOf("anchura de escala") >= 0 || nm.indexOf("ancho de escala") >= 0) pw = props[pi];
                    }
                    try {
                        if (uni) { uni.setValue(newScale, true); applied = true; }
                        else if (ph && pw) { ph.setValue(newScale, true); pw.setValue(newScale, true); applied = true; }
                        else if (props.numItems > 1) { props[1].setValue(newScale, true); applied = true; }
                    } catch (eV) { err(cl.name + ": " + eV); }
                }
                if (applied) res.scaled++;
                else err(cl.name + ": no encontre Motion > Scale");
            }
        }
        res.ok = res.scaled > 0 || res.errors.length === 0;
        if (!res.scaled && !res.errors.length) err("No hay clips de video seleccionados");
        return J(res);
    } catch (e) { res.errors.push("FATAL: " + e.toString() + " (linea " + e.line + ")"); return J(res); }
}
