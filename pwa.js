(() => {
  function removeSplash() {
    const splash = document.getElementById("app-splash");
    if (!splash) {
      return;
    }

    splash.setAttribute("aria-hidden", "true");
    const teardown = () => {
      if (splash.parentNode) {
        splash.remove();
      }
    };

    splash.addEventListener("transitionend", teardown, { once: true });
    window.setTimeout(teardown, 600);
  }

  function markAppReady() {
    document.body.classList.add("app-ready");
    removeSplash();
  }

  window.markAppReady = markAppReady;

  document.addEventListener("DOMContentLoaded", () => {
    markAppReady();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js").catch((error) => {
        console.error("Service worker registration failed", error);
      });
    });
  }
})();
