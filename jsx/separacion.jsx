/* Separación v2 - jsx/separacion.jsx
   SP_ping · SP_readSel · SP_spread · SP_prepareSync · SP_restack · SP_backup
   El diálogo Synchronize nativo lo abre el PANEL via osascript (no el JSX). */

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

function findProjectItemByMediaPath(mp) {
    var it = null;
    (function walk(bin) {
        if (it) return;
        var n = bin.children.numItems;
        for (var i = 0; i < n; i++) {
            var ch = bin.children[i];
            if (ch.type === ProjectItemType.BIN) { walk(ch); continue; }
            try { if (ch.getMediaPath() === mp) { it = ch; return; } } catch (e) {}
        }
    })(app.project.rootItem);
    return it;
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

/* lee clips seleccionados; si no hay seleccion, V1 completa */
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
                    end: cl.end.seconds - res.zeroSec, name: cl.name, inSec: cl.inPoint.seconds, mp: "" });
                try { if (sel) clips[clips.length - 1].mp = cl.projectItem.getMediaPath(); } catch (eM) {}
            }
        }
        if (!clips.length) {
            var tr0 = seq.videoTracks[0];
            for (var c2 = 0; c2 < tr0.clips.numItems; c2++) {
                var cl2 = tr0.clips[c2];
                clips.push({ track: 0, start: cl2.start.seconds - res.zeroSec,
                    end: cl2.end.seconds - res.zeroSec, name: cl2.name, inSec: cl2.inPoint.seconds, mp: "" });
                try { clips[clips.length - 1].mp = cl2.projectItem.getMediaPath(); } catch (eM2) {}
            }
            res.source = "V1 completa";
        } else res.source = "seleccion";
        res.clips = clips;
        res.count = clips.length;
        return J(res);
    } catch (e) { res.error = e.toString(); return J(res); }
}

/* SPREAD: recoge los clips, los quita y recoloca 1 por pista, mismo instante */
function SP_spread() {
    var res = { ok: false, spread: 0, errors: [] };
    function err(m) { res.errors.push(String(m)); }
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) { err("No hay secuencia activa"); return J(res); }
        var zero = getZeroSec(seq);
        var read = eval("(" + SP_readSel() + ")");
        if (!read.ok || !read.clips.length) { err("No hay clips (selecciona o usa V1)"); return J(res); }
        var clips = read.clips;
        if (clips.length > seq.videoTracks.numTracks) {
            err("Hay " + clips.length + " clips pero solo " + seq.videoTracks.numTracks +
                " pistas de vídeo. Añade pistas (botón + en la cabecera de la timeline) y reintenta.");
            return J(res);
        }
        var items = [], missing = [];
        for (var i = 0; i < clips.length; i++) {
            var it = clips[i].mp ? findProjectItemByMediaPath(clips[i].mp) : null;
            if (!it) missing.push(clips[i].name || ("clip " + (i + 1)));
            items.push(it);
        }
        if (missing.length) { err("No encuentro estos medios en el proyecto: " + missing.join(", ") + " (¿anidados?)"); return J(res); }

        var tr0 = seq.videoTracks[0];
        while (tr0.clips.numItems > 0) {
            try { tr0.clips[0].remove(false, false); }
            catch (eR) { err("quitando: " + eR); break; }
        }
        for (var k = 0; k < clips.length; k++) {
            var c = clips[k], item = items[k];
            try {
                item.setInPoint(c.inSec, 4);
                item.setOutPoint(c.inSec + (c.end - c.start), 4);
                seq.videoTracks[k].overwriteClip(item, c.start + zero);
                try { item.clearInPoint(4); } catch (e1) {}
                try { item.clearOutPoint(4); } catch (e2) {}
                res.spread++;
            } catch (eP) { err("clip " + (k + 1) + ": " + eP); }
        }
        res.ok = res.spread > 0;
        return J(res);
    } catch (e) { res.errors.push("FATAL: " + e.toString() + " (linea " + e.line + ")"); return J(res); }
}

/* prepara el sync: selecciona TODOS los clips de todas las pistas de vídeo */
function SP_prepareSync() {
    var res = { ok: false, selected: 0, audioTracks: 0 };
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) { res.error = "No hay secuencia activa"; return J(res); }
        res.ok = true;
        for (var t = 0; t < seq.audioTracks.numTracks; t++)
            if (seq.audioTracks[t].clips.numItems > 0) res.audioTracks++;
        var first = true;
        for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var tr = seq.videoTracks[v];
            for (var c = 0; c < tr.clips.numItems; c++) {
                try {
                    tr.clips[c].setSelected(true, first);  // el primero deselecciona el resto
                    first = false;
                    res.selected++;
                } catch (eSel) {}
            }
        }
        if (!res.selected) res.error = "No hay clips que seleccionar";
        return J(res);
    } catch (e) { res.error = e.toString(); return J(res); }
}

/* RE-STACK: agrupa los clips por instante de inicio y los apila en cascada desde V1 */
function SP_restack() {
    var res = { ok: false, stacked: 0, errors: [] };
    function err(m) { res.errors.push(String(m)); }
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) { err("No hay secuencia activa"); return J(res); }
        var zero = getZeroSec(seq);
        var clips = [];
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var tr = seq.videoTracks[t];
            for (var c = 0; c < tr.clips.numItems; c++) {
                var cl = tr.clips[c];
                clips.push({ start: cl.start.seconds, end: cl.end.seconds,
                             inSec: cl.inPoint.seconds, mp: "", name: cl.name });
                try { clips[clips.length - 1].mp = cl.projectItem.getMediaPath(); } catch (eM) {}
            }
        }
        if (!clips.length) { err("No hay clips"); return J(res); }
        var items = [];
        for (var i2 = 0; i2 < clips.length; i2++) items.push(clips[i2].mp ? findProjectItemByMediaPath(clips[i2].mp) : null);
        for (var t2 = 0; t2 < seq.videoTracks.numTracks; t2++) {
            var trR = seq.videoTracks[t2];
            while (trR.clips.numItems > 0) {
                try { trR.clips[0].remove(false, false); } catch (eR2) { err("quitando: " + eR2); break; }
            }
        }
        var byStart = {};
        for (var k = 0; k < clips.length; k++) {
            var key = Math.round(clips[k].start * 25);
            (byStart[key] = byStart[key] || []).push(k);
        }
        var groups = Object.keys(byStart).map(Number).sort(function (a, b) { return a - b; });
        var slot = 0;
        for (var g = 0; g < groups.length; g++) {
            var grp = byStart[groups[g]];
            for (var j = 0; j < grp.length; j++) {
                var idx = grp[j], c = clips[idx], it = items[idx];
                if (!it) { err("media no encontrado: " + (c.name || idx)); continue; }
                try {
                    it.setInPoint(c.inSec, 4);
                    it.setOutPoint(c.inSec + (c.end - c.start), 4);
                    seq.videoTracks[slot % seq.videoTracks.numTracks].overwriteClip(it, c.start + zero);
                    try { it.clearInPoint(4); } catch (e1) {}
                    try { it.clearOutPoint(4); } catch (e2) {}
                    res.stacked++; slot++;
                } catch (eP) { err("recolocando " + (c.name || idx) + ": " + eP); }
            }
        }
        res.ok = res.stacked > 0;
        return J(res);
    } catch (e) { res.errors.push("FATAL: " + e.toString() + " (linea " + e.line + ")"); return J(res); }
}

function SP_backup() {
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) return J({ ok: false, error: "No hay secuencia activa" });
        var cl = null;
        try { cl = seq.clone(); } catch (e1) { cl = null; }
        if (!cl) { try { cl = app.project.createNewSequenceFromSequence(seq.name + " [BACKUP]", seq); } catch (e2) { cl = null; } }
        if (!cl) return J({ ok: false, error: "No se pudo clonar" });
        return J({ ok: true, name: cl.name });
    } catch (e) { return J({ ok: false, error: String(e) }); }
}
