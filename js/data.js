/* =========================================================
   data.js: every page gets its data through Data.load(name).
   Pages never need to know whether it came from Flask or the bundle.
   ========================================================= */
const Data = (() => {
  const cache = {};
  let fellBack = false;

  async function load(name) {
    if (cache[name]) return cache[name];

    if (APP_CONFIG.DATA_SOURCE === "api") {
      try {
        const res = await fetch(APP_CONFIG.API_BASE + APP_CONFIG.ENDPOINTS[name]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (cache[name] = await res.json());
      } catch (err) {
        console.warn(`API ${APP_CONFIG.ENDPOINTS[name]} failed (${err.message}), using bundled data.`);
        fellBack = true;
        Layout.toast(`The server didn't return ${name.replace("_", " ")}. Showing the bundled copy instead.`);
      }
    }

    const bundle = window.PHALOMBE_DATA;
    if (!bundle || !bundle[name]) {
      Layout.toast(`Layer "${name}" is missing. Run tools/build_frontend_data.py.`);
      return (cache[name] = { type: "FeatureCollection", features: [] });
    }
    return (cache[name] = bundle[name]);
  }

  // Load several layers in parallel: const { tas, rivers } = await Data.loadAll(["tas", "rivers"])
  async function loadAll(names) {
    const results = await Promise.all(names.map(load));
    return Object.fromEntries(names.map((n, i) => [n, results[i]]));
  }

  const isLive = () => APP_CONFIG.DATA_SOURCE === "api" && !fellBack;

  return { load, loadAll, isLive };
})();
