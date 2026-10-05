/*
 * simulator.js
 * ---------------------------------------------------------------
 * Simulated location SOURCE. It only builds location messages and
 * hands them to a sink function (set by app.js to the telemetry
 * receiver). It never touches the map or entity state.
 * ---------------------------------------------------------------
 */


  const INTERVAL_MS = 2000;
  const STEPS = 30; // path length before it walks back (ping-pong)
  let timer = null;
  let sink = null;
  let step = 0;
  let dir = 1;

  function nextMessage(entityId) {
    // Slow drift south-east near Maitri; first fixes match the spec example.
    const lat = -70.7521 - 0.0031 * step;
    const lon = 11.8234 + 0.0279 * step;
    if (step + dir < 0 || step + dir >= STEPS) dir = -dir;
    step += dir;
    return {
      entity_id: entityId,
      timestamp: new Date().toISOString(),
      latitude: Number(lat.toFixed(5)),
      longitude: Number(lon.toFixed(5)),
      accuracy_m: Number((5 + Math.random() * 7).toFixed(1)),
      source: "SIMULATED_GPS"
    };
  }

  function start(entityId, messageSink) {
    if (timer) return;
    sink = messageSink;
    step = 0;
    dir = 1;
    const tick = () => sink(nextMessage(entityId));
    tick();
    timer = setInterval(tick, INTERVAL_MS);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  export const AppSimulator = { start: start, stop: stop, isRunning: () => !!timer };

