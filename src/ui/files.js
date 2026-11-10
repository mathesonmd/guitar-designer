// Saving and opening files. Inside a claude.ai artifact, pages cannot start downloads themselves, so
// saves go through the viewer's "downloads" capability (the viewer confirms each file). Everywhere
// else (the Black Chapel site, a local copy) a normal browser download is used.
let capPromise = null;
function downloadsCap() {
  if (!capPromise) {
    capPromise = (typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function')
      ? window.claude.use('downloads').catch(() => null)
      : Promise.resolve(undefined); // undefined = not inside a viewer at all
  }
  return capPromise;
}
// ask early so the answer is ready by the time someone clicks Save
if (typeof window !== 'undefined') setTimeout(downloadsCap, 0);

export const inViewer = () => typeof window !== 'undefined' && !!(window.claude && window.claude.use);

// Returns { ok, message }.
export async function saveFile(filename, data) {
  const cap = await downloadsCap();
  if (cap) {
    try {
      await cap.save({ filename, data });
      return { ok: true, message: `Saved ${filename}` };
    } catch (e) {
      const code = e && e.code;
      if (code === 'declined') return { ok: false, message: 'Save canceled.' };
      if (code === 'rate_limited') return { ok: false, message: 'Another save is still open. Finish it, then try again.' };
      if (code === 'rejected_extension' || code === 'extension_not_enabled') return { ok: false, message: `This viewer cannot save ${filename.split('.').pop().toUpperCase()} files directly. Use the template pack (.zip) instead.` };
      return { ok: false, message: 'Saving is not available in this view.' };
    }
  }
  if (cap === null && inViewer()) return { ok: false, message: 'Saving is not available in this view. Open the page in claude.ai, or use the copy on the Black Chapel site.' };
  try {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { ok: true, message: `Download started: ${filename}` };
  } catch (e) {
    return { ok: false, message: 'The browser blocked the download.' };
  }
}

export const readText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(file); });
export const readDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file); });

export const slug = (name) => (String(name || 'guitar').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'guitar');
