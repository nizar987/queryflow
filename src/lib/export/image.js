// Export diagram as SVG / PNG (PRD §4.3, PLAN §7).
// Serializes the live diagram <svg> node; PNG via canvas rasterization.

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text, filename, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

function serializeSVG(svgEl) {
  const clone = svgEl.cloneNode(true);
  // inline computed background so exported image isn't transparent-on-white
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '0');
  bg.setAttribute('y', '0');
  bg.setAttribute('width', clone.getAttribute('width') || '100%');
  bg.setAttribute('height', clone.getAttribute('height') || '100%');
  bg.setAttribute('fill', '#0f1115');
  clone.insertBefore(bg, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

export function exportSVG(svgEl, filename = 'queryflow-diagram.svg') {
  const str = serializeSVG(svgEl);
  downloadText(str, filename, 'image/svg+xml');
}

export function exportPNG(svgEl, filename = 'queryflow-diagram.png', scale = 2) {
  return new Promise((resolve, reject) => {
    const str = serializeSVG(svgEl);
    const w = parseFloat(svgEl.getAttribute('width')) || svgEl.viewBox.baseVal.width || 800;
    const h = parseFloat(svgEl.getAttribute('height')) || svgEl.viewBox.baseVal.height || 600;
    const img = new Image();
    const svgBlob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) {
          downloadBlob(blob, filename);
          resolve();
        } else reject(new Error('PNG encode gagal'));
      }, 'image/png');
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}
