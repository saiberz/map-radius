(() => {
  "use strict";

  const STORAGE_KEY = "map-radius:v1";
  const METERS_PER_UNIT = { km: 1000, mi: 1609.344 };
  const SLIDER_MAX = 100;

  // ---------- State ----------

  const defaults = { center: null, radius: 5, unit: "km", points: [] };
  const state = load();
  let mode = state.center ? "points" : "center";

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved || typeof saved !== "object") return { ...defaults };
      return {
        center: isLatLng(saved.center) ? saved.center : null,
        radius: Number(saved.radius) > 0 ? Number(saved.radius) : defaults.radius,
        unit: saved.unit in METERS_PER_UNIT ? saved.unit : defaults.unit,
        points: Array.isArray(saved.points)
          ? saved.points.filter(isLatLng).map((p) => ({
              id: String(p.id || newId()),
              name: String(p.name || "Point"),
              lat: p.lat,
              lng: p.lng,
            }))
          : [],
      };
    } catch {
      return { ...defaults };
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage unavailable (private mode, blocked) — app still works for this session
    }
  }

  function isLatLng(v) {
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lng);
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  const radiusMeters = () => state.radius * METERS_PER_UNIT[state.unit];

  // ---------- Map ----------

  const map = L.map("map", { worldCopyJump: true }).setView([20, 0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const centerIcon = L.divIcon({ className: "", html: '<div class="center-pin"></div>', iconSize: [22, 22] });
  const pointIcon = (status) => L.divIcon({ className: "", html: `<div class="pt ${status}"></div>`, iconSize: [18, 18] });

  let centerMarker = null;
  let circle = null;
  const markers = new Map(); // point id -> L.Marker

  // ---------- Center & circle ----------

  function setCenter(latlng, { fit = false } = {}) {
    state.center = { lat: latlng.lat, lng: latlng.lng };

    if (!centerMarker) {
      centerMarker = L.marker(latlng, { icon: centerIcon, draggable: true, zIndexOffset: 1000, title: "Center (drag to move)" })
        .addTo(map)
        .on("drag", (e) => {
          state.center = { lat: e.latlng.lat, lng: e.latlng.lng };
          circle.setLatLng(e.latlng);
          refreshPoints();
        })
        .on("dragend", () => {
          save();
          renderCenterInfo();
        });
      circle = L.circle(latlng, {
        radius: radiusMeters(),
        color: "#2563eb",
        weight: 2,
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(map);
    } else {
      centerMarker.setLatLng(latlng);
      circle.setLatLng(latlng);
    }

    refreshPoints();
    renderCenterInfo();
    save();
    if (fit) fitAll();
  }

  function updateRadius(value) {
    const v = Number(value);
    if (!(v > 0)) return;
    state.radius = v;
    if (circle) circle.setRadius(radiusMeters());
    syncRadiusInputs();
    refreshPoints();
    save();
  }

  // ---------- Points ----------

  function distanceTo(p) {
    return state.center ? map.distance(state.center, p) : null;
  }

  function statusOf(p) {
    const d = distanceTo(p);
    if (d === null) return "none";
    return d <= radiusMeters() ? "in" : "out";
  }

  function addPoint(latlng, name) {
    const p = {
      id: newId(),
      name: name || `Point ${state.points.length + 1}`,
      lat: latlng.lat,
      lng: latlng.lng,
    };
    state.points.push(p);
    createMarker(p);
    renderList();
    save();
    return p;
  }

  function createMarker(p) {
    const marker = L.marker([p.lat, p.lng], { icon: pointIcon(statusOf(p)), draggable: true, title: p.name })
      .addTo(map)
      .bindPopup(() => buildPopup(p))
      .on("drag", (e) => {
        p.lat = e.latlng.lat;
        p.lng = e.latlng.lng;
        marker.setIcon(pointIcon(statusOf(p)));
      })
      .on("dragend", () => {
        renderList();
        save();
      });
    markers.set(p.id, marker);
  }

  function buildPopup(p) {
    const wrap = document.createElement("div");
    wrap.className = "popup";

    const input = document.createElement("input");
    input.className = "point-name";
    input.value = p.name;
    input.setAttribute("aria-label", "Point name");
    input.addEventListener("input", () => {
      p.name = input.value.trim() || "Point";
      markers.get(p.id).options.title = p.name;
      renderList();
      save();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") map.closePopup();
    });

    const meta = document.createElement("div");
    meta.className = "meta";
    const d = distanceTo(p);
    meta.textContent =
      d === null
        ? "No center set"
        : `${formatDistance(d)} from center · ${statusOf(p) === "in" ? "✅ inside" : "❌ outside"}`;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "Delete point";
    del.addEventListener("click", () => removePoint(p.id));

    wrap.append(input, meta, del);
    return wrap;
  }

  function removePoint(id) {
    const marker = markers.get(id);
    if (marker) {
      marker.remove();
      markers.delete(id);
    }
    state.points = state.points.filter((p) => p.id !== id);
    renderList();
    save();
  }

  // Re-color markers and redraw the list after the center or radius changes.
  function refreshPoints() {
    for (const p of state.points) {
      markers.get(p.id)?.setIcon(pointIcon(statusOf(p)));
    }
    renderList();
  }

  // ---------- Formatting ----------

  function formatDistance(meters) {
    if (state.unit === "mi") {
      const mi = meters / METERS_PER_UNIT.mi;
      return mi < 0.1 ? `${Math.round(meters * 3.28084)} ft` : `${mi.toFixed(2)} mi`;
    }
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(2)} km`;
  }

  const round = (n, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

  // ---------- UI ----------

  const $ = (id) => document.getElementById(id);
  const ui = {
    panel: $("panel"),
    collapse: $("collapse"),
    hint: $("hint"),
    modeBtns: document.querySelectorAll(".mode-btn"),
    unitBtns: document.querySelectorAll(".unit-btn"),
    range: $("radius-range"),
    number: $("radius-number"),
    centerInfo: $("center-info"),
    list: $("point-list"),
    empty: $("empty"),
    summary: $("summary"),
    search: $("search"),
    searchInput: $("search-input"),
    locate: $("locate"),
    status: $("status"),
    fit: $("fit"),
    clear: $("clear"),
  };

  function setMode(next) {
    mode = next;
    ui.modeBtns.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
    map.getContainer().classList.toggle("mode-center", mode === "center");
    map.getContainer().classList.toggle("mode-points", mode === "points");
    ui.hint.textContent =
      mode === "center"
        ? "Click the map (or search an address) to set the center."
        : "Click the map (or search an address) to add a point. Drag any marker to move it.";
  }

  function syncRadiusInputs() {
    ui.range.value = Math.min(state.radius, SLIDER_MAX);
    if (document.activeElement !== ui.number) ui.number.value = state.radius;
    ui.unitBtns.forEach((b) => b.classList.toggle("active", b.dataset.unit === state.unit));
  }

  function renderCenterInfo() {
    ui.centerInfo.textContent = state.center
      ? `Center: ${state.center.lat.toFixed(5)}, ${state.center.lng.toFixed(5)}`
      : "No center yet.";
  }

  function renderList() {
    const rows = state.points.map((p) => ({ p, d: distanceTo(p), s: statusOf(p) }));
    if (state.center) rows.sort((a, b) => a.d - b.d);

    ui.list.replaceChildren(
      ...rows.map(({ p, d, s }) => {
        const li = document.createElement("li");
        li.tabIndex = 0;
        li.title = "Show on map";

        const dot = document.createElement("span");
        dot.className = `dot ${s}`;
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = p.name;
        const dist = document.createElement("span");
        dist.className = "dist";
        dist.textContent = d === null ? "—" : formatDistance(d);
        const badge = document.createElement("span");
        badge.textContent = s === "in" ? "✅" : s === "out" ? "❌" : "";

        li.append(dot, name, dist, badge);
        const open = () => {
          map.panTo([p.lat, p.lng]);
          markers.get(p.id)?.openPopup();
        };
        li.addEventListener("click", open);
        li.addEventListener("keydown", (e) => {
          if (e.key === "Enter") open();
        });
        return li;
      })
    );

    ui.empty.hidden = state.points.length > 0;
    const inside = rows.filter((r) => r.s === "in").length;
    ui.summary.textContent = !state.points.length
      ? ""
      : state.center
        ? `${inside} of ${state.points.length} inside`
        : `${state.points.length} point${state.points.length === 1 ? "" : "s"}`;
  }

  function setStatus(text) {
    ui.status.textContent = text;
  }

  function fitAll() {
    const bounds = L.latLngBounds([]);
    if (circle) bounds.extend(circle.getBounds());
    state.points.forEach((p) => bounds.extend([p.lat, p.lng]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
  }

  // ---------- Events ----------

  // Clicking the map to dismiss a popup shouldn't also drop a point.
  let lastPopupClose = 0;
  map.on("popupclose", () => (lastPopupClose = Date.now()));

  map.on("click", (e) => {
    if (Date.now() - lastPopupClose < 300) return;
    if (mode === "center") {
      setCenter(e.latlng);
      setMode("points");
    } else {
      addPoint(e.latlng);
    }
  });

  ui.modeBtns.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

  ui.range.addEventListener("input", () => updateRadius(ui.range.value));
  ui.number.addEventListener("input", () => updateRadius(ui.number.value));
  ui.number.addEventListener("change", syncRadiusInputs);

  ui.unitBtns.forEach((b) =>
    b.addEventListener("click", () => {
      const unit = b.dataset.unit;
      if (unit === state.unit) return;
      // keep the same physical radius, just express it in the new unit
      const meters = radiusMeters();
      state.unit = unit;
      updateRadius(Math.max(0.1, round(meters / METERS_PER_UNIT[unit])));
    })
  );

  ui.collapse.addEventListener("click", () => {
    const collapsed = ui.panel.classList.toggle("collapsed");
    ui.collapse.setAttribute("aria-expanded", String(!collapsed));
  });

  ui.fit.addEventListener("click", fitAll);

  ui.clear.addEventListener("click", () => {
    if (!state.points.length && !state.center) return;
    if (!confirm("Remove the center and all points?")) return;
    markers.forEach((m) => m.remove());
    markers.clear();
    state.points = [];
    if (centerMarker) {
      centerMarker.remove();
      circle.remove();
      centerMarker = circle = null;
    }
    state.center = null;
    save();
    renderList();
    renderCenterInfo();
    setMode("center");
  });

  ui.search.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = ui.searchInput.value.trim();
    if (!q) return;
    setStatus("Searching…");
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const [hit] = await res.json();
      if (!hit) {
        setStatus(`No results for “${q}”.`);
        return;
      }
      const latlng = L.latLng(Number(hit.lat), Number(hit.lon));
      const label = hit.display_name.split(",")[0];
      if (mode === "center") {
        setCenter(latlng, { fit: true });
        setMode("points");
        setStatus(`Center set to ${label}.`);
      } else {
        addPoint(latlng, label);
        fitAll();
        setStatus(`Added “${label}”.`);
      }
      ui.searchInput.value = "";
    } catch (err) {
      setStatus("Search failed. Check your connection and try again.");
      console.error(err);
    }
  });

  // ---------- Location ----------

  // Precise location: the browser asks the user for permission.
  function locateMe() {
    if (!navigator.geolocation) {
      setStatus("Your browser doesn't support location. Click the map or search an address.");
      return;
    }
    setStatus("Waiting for location permission…");
    ui.locate.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        ui.locate.disabled = false;
        setCenter(L.latLng(pos.coords.latitude, pos.coords.longitude), { fit: true });
        setMode("points");
        setStatus(`Center set to your location (±${Math.round(pos.coords.accuracy)} m).`);
      },
      (err) => {
        ui.locate.disabled = false;
        setStatus(
          err.code === err.PERMISSION_DENIED
            ? "Location permission denied. Click the map or search an address instead."
            : "Couldn't get your location. Click the map or search an address instead."
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  // Approximate (city-level) guess from the IP address — no permission prompt.
  // Tries a couple of free, key-less services in order.
  async function guessFromIp() {
    const services = [
      ["https://get.geojs.io/v1/ip/geo.json", (d) => [d.latitude, d.longitude, d.city]],
      ["https://ipapi.co/json/", (d) => [d.latitude, d.longitude, d.city]],
    ];
    for (const [url, parse] of services) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const [lat, lng, city] = parse(await res.json());
        if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) && (Number(lat) || Number(lng))) {
          return { latlng: L.latLng(Number(lat), Number(lng)), city };
        }
      } catch {
        // try the next service
      }
    }
    return null;
  }

  ui.locate.addEventListener("click", locateMe);

  // ---------- Init ----------

  if (state.center) setCenter(state.center);
  state.points.forEach(createMarker);
  syncRadiusInputs();
  renderCenterInfo();
  renderList();
  setMode(mode);
  fitAll();

  // First visit: default the center to an approximate IP-based location.
  if (!state.center) {
    setStatus("Finding your approximate area…");
    guessFromIp().then((guess) => {
      if (state.center) return; // the user already picked a center meanwhile
      if (!guess) {
        setStatus("");
        return;
      }
      setCenter(guess.latlng, { fit: true });
      setStatus(
        `Approximate center${guess.city ? ` near ${guess.city}` : ""} (from your IP). ` +
          "Use 📍 for your precise location, or click the map."
      );
    });
  }
})();
