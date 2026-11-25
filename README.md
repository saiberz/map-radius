# Map Radius

Pick a center on the map, set a radius, and add points to see which ones are inside it.

- **Set center:** click the map or search an address. Drag the blue marker to move it.
- **Radius:** use the slider or type a value, in km or miles. The circle updates live.
- **Add points:** click the map or search an address.
  - Points inside the radius turn green and points outside turn red.
  - Click a point to rename or delete it.
  - The panel lists every point with its distance from the center.
- **Saving:** everything is saved in your browser (`localStorage`) and comes back when you reload the page.

There's no backend and no build step. It's plain HTML, CSS and JS using
[Leaflet](https://leafletjs.com) and [OpenStreetMap](https://www.openstreetmap.org) tiles.
Address search uses OpenStreetMap's free [Nominatim](https://nominatim.org) service.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy to GitHub Pages

```sh
git init && git add . && git commit -m "Map radius app"
gh repo create map-radius --public --source=. --push
```

Then on GitHub, go to **Settings → Pages → Build and deployment**. Set **Source** to *Deploy from a branch* and **Branch** to `main` / `(root)`, then click **Save**.

After a minute or so the site is live at `https://<your-username>.github.io/map-radius/`.
