window.AVEIR_IMAGE = window.AVEIR_IMAGE || (function () {
  const AVEIR_THUMB_EDGE = 460;
  const AVEIR_THUMB_BYTES = 30000;
  const AVEIR_FULL_EDGE = 1000;
  const AVEIR_FULL_BYTES = 92000;
  const AVEIR_QUALITY_START = 0.82;
  const AVEIR_QUALITY_FLOOR = 0.34;
  const AVEIR_QUALITY_STEP = 0.08;
  const AVEIR_EDGE_FLOOR = 240;
  const AVEIR_SOURCE_LIMIT = 25 * 1024 * 1024;

  let webp = null;

  function canWebp() {
    if (webp !== null) return webp;
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    webp = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    return webp;
  }

  function load(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('THAT FILE IS NOT AN IMAGE WE CAN READ'));
      img.src = src;
    });
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('COULD NOT READ THAT FILE'));
      r.readAsDataURL(file);
    });
  }

  function draw(img, edge) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, edge / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  function encode(canvas, quality) {
    return canWebp() ? canvas.toDataURL('image/webp', quality) : canvas.toDataURL('image/png');
  }

  async function shrink(source, edge, budget) {
    const src = typeof source === 'string' ? source : await readFile(source);
    if (typeof source !== 'string' && source.size > AVEIR_SOURCE_LIMIT) throw new Error('THAT PHOTO IS HUGE. USE ONE UNDER 25MB.');
    const img = await load(src);
    let box = edge;
    while (box >= AVEIR_EDGE_FLOOR) {
      const canvas = draw(img, box);
      let q = AVEIR_QUALITY_START;
      let best = encode(canvas, q);
      if (!canWebp()) {
        if (best.length <= budget) return best;
        box = Math.round(box * 0.72);
        continue;
      }
      while (best.length > budget && q > AVEIR_QUALITY_FLOOR) {
        q = Math.max(AVEIR_QUALITY_FLOOR, q - AVEIR_QUALITY_STEP);
        best = encode(canvas, q);
      }
      if (best.length <= budget) return best;
      box = Math.round(box * 0.78);
    }
    throw new Error('COULD NOT SHRINK THAT PHOTO ENOUGH. TRY A SIMPLER IMAGE.');
  }

  return {
    thumbBytes: AVEIR_THUMB_BYTES,
    fullBytes: AVEIR_FULL_BYTES,
    supported: canWebp,
    full(source) { return shrink(source, AVEIR_FULL_EDGE, AVEIR_FULL_BYTES); },
    thumb(source) { return shrink(source, AVEIR_THUMB_EDGE, AVEIR_THUMB_BYTES); },
    async pair(source) {
      const src = typeof source === 'string' ? source : await readFile(source);
      const full = await shrink(src, AVEIR_FULL_EDGE, AVEIR_FULL_BYTES);
      const thumb = await shrink(full, AVEIR_THUMB_EDGE, AVEIR_THUMB_BYTES);
      return { full, thumb };
    }
  };
})();
