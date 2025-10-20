// pdf-preview.js
(() => {
    'use strict';
  
    // -------- Config --------
    const HOVER_DELAY_MS = 600;     // wait before loading
    const MAX_WIDTH_PX   = 420;     // CSS width of preview
    const POP_ZINDEX     = 9999;
  
    // -------- Guards --------
    function onPdfReady(cb) {
      if (window.pdfjsLib) return cb();
      window.addEventListener('DOMContentLoaded', () => {
        if (!window.pdfjsLib) {
          console.error('pdfjsLib not available. Check script tags and version.');
          return;
        }
        cb();
      });
    }
  
    onPdfReady(() => {
      // Fallback: set workerSrc if not already set by the page
      try {
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.js";
        }
      } catch { /* ignore */ }
  
      // -------- Styles (injected once) --------
      if (!document.getElementById('bm-pdf-preview-styles')) {
        const css = `
          .bm-pdf-preview-pop {
            position: absolute;
            z-index: ${POP_ZINDEX};
            background: #fff;
            border: 1px solid #ccc;
            box-shadow: 0 6px 24px rgba(0,0,0,.2);
            padding: 6px;
            border-radius: 6px;
            display: none;
            max-width: ${MAX_WIDTH_PX + 60}px;
            max-height: 640px;
            overflow: auto;
            min-width: ${MAX_WIDTH_PX}px;
            min-height: 80px;
          }
          .bm-pdf-preview-pop canvas { display:block; width:100%; height:auto; }
          .bm-pdf-preview-status { font-size: 12px; color: #444; }
        `.trim();
        const style = document.createElement('style');
        style.id = 'bm-pdf-preview-styles';
        style.textContent = css;
        document.head.appendChild(style);
      }
  
      // -------- Elements --------
      const pop = document.createElement('div');
      pop.className = 'bm-pdf-preview-pop';
      document.body.appendChild(pop);
  
      // -------- Cache --------
      const cache = new Map(); // url -> Promise<HTMLCanvasElement|null>
  
      // -------- Helpers --------
      function isPdfLink(a) {
        const href = a.getAttribute('href') || '';
        return /\.pdf(\?|#|$)/i.test(href);
      }
  
      function absUrl(a) {
        let href = a.getAttribute('href') || '';
        // Already absolute?
        try { return new URL(href).href; } catch {}
      
        // If href begins with "/" and we're on a project page, prefix the repo segment.
        if (href.startsWith('/')) {
          const segs = window.location.pathname.split('/').filter(Boolean);
          // segs[0] === repo name on project pages like /BAND-MAID_gpt/...
          if (segs.length >= 1) {
            href = `/${segs[0]}${href}`;      // "/BAND-MAID_gpt" + "/Reports/.."
          }
          // else: user site root; keep as-is
        }
      
        // Resolve against full current URL to preserve subpath
        return new URL(href, window.location.href).href;
      }
          
      function positionPopup(anchor) {
        const r = anchor.getBoundingClientRect();
        const margin = 8;
        const docW = document.documentElement.clientWidth;
        const left = Math.min(
          window.scrollX + r.left,
          window.scrollX + docW - pop.offsetWidth - margin
        );
        const top = window.scrollY + r.bottom + margin;
        pop.style.left = `${left}px`;
        pop.style.top  = `${top}px`;
      }
  
      function hidePopup() {
        pop.style.display = 'none';
        pop.replaceChildren();
      }
  
      async function renderFirstPage(url) {
        if (cache.has(url)) return cache.get(url);
  
        const p = pdfjsLib.getDocument(url).promise
          .then(doc => doc.getPage(1))
          .then(page => {
            // Fit width, render at device pixel ratio for sharpness
            const base = page.getViewport({ scale: 1 });
            const cssWidth = Math.min(MAX_WIDTH_PX, base.width);
            const scale = cssWidth / base.width;
  
            const viewport = page.getViewport({ scale });
            const dpr = Math.max(1, window.devicePixelRatio || 1);
  
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { alpha: false });
  
            canvas.width  = Math.round(viewport.width  * dpr);
            canvas.height = Math.round(viewport.height * dpr);
            canvas.style.width  = `${Math.round(viewport.width)}px`;
            canvas.style.height = `${Math.round(viewport.height)}px`;
  
            // Scale drawing to DPR
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  
            return page.render({ canvasContext: ctx, viewport }).promise.then(() => canvas);
          })
          .catch((e) => {
            console.warn('PDF preview failed:', e);
            return null;
          });
  
        cache.set(url, p);
        return p;
      }
  
      function attach(a) {
        if (!isPdfLink(a)) return;
        if (a.dataset.bmPdfPreviewAttached === '1') return;
        a.dataset.bmPdfPreviewAttached = '1';
  
        let timer = null;
  
        const show = async () => {
          pop.replaceChildren();
          pop.style.display = 'block';
          positionPopup(a);
  
          const status = document.createElement('div');
          status.className = 'bm-pdf-preview-status';
          status.textContent = 'Loading preview…';
          pop.appendChild(status);
  
          // **
          async function urlOk(url) {
            try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; }
            catch { return false; }
          }
          
          // before rendering:
          const url = absUrl(a);
          console.debug('PDF preview URL:', url);
          if (!(await urlOk(url))) {
            pop.replaceChildren(Object.assign(document.createElement('div'), {
              className: 'bm-pdf-preview-status',
              textContent: 'File not found (404). Check path/case.'
            }));
            return;
          }
          // **

          const canvas = await renderFirstPage(url);
  
          pop.replaceChildren();
          if (canvas) pop.appendChild(canvas);
          else {
            const err = document.createElement('div');
            err.className = 'bm-pdf-preview-status';
            err.textContent = 'Preview unavailable. Check CORS or file path.';
            pop.appendChild(err);
          }
  
          positionPopup(a);
        };
  
        a.addEventListener('mouseenter', () => {
          clearTimeout(timer);
          timer = setTimeout(show, HOVER_DELAY_MS);
        });
  
        function cancel() {
          clearTimeout(timer);
          hidePopup();
        }
  
        a.addEventListener('mouseleave', cancel);
        pop.addEventListener('mouseleave', cancel);
        pop.addEventListener('mouseenter', () => clearTimeout(timer));
  
        // Keyboard focus support
        a.addEventListener('focus', () => a.dispatchEvent(new Event('mouseenter')));
        a.addEventListener('blur', () => a.dispatchEvent(new Event('mouseleave')));
      }
  
      // -------- Init / Observe --------
      function scan() {
        document.querySelectorAll('a[href]').forEach(attach);
      }
      scan();
  
      const obs = new MutationObserver(() => scan());
      obs.observe(document.body, { childList: true, subtree: true });
  
      // Esc to close
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hidePopup();
      });
    });
  })();
  