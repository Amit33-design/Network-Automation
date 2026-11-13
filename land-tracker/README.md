# Family Land Register

A one-page website for tracking family land, farm land and house land in
Harpur (Bihar) and Greater Noida. No server or build step — open `index.html`.

## Using it

- **City filter**: All cities / Harpur, Bihar / Greater Noida
- **Land type filter**: All land / Family land / Farm land / House land
- Both filters work together; "All" in both shows every record.
- Search box matches name, address, khata / khesra number, owner and notes.
- Click a card for full details, all photographs and a Google Maps link.

## Adding or changing land

1. Open `lands.js` and copy one `{ ... }` block inside `LANDS`.
2. Fill in name, location, type, area, address and the other fields.
3. Put photographs in the `photos/` folder and list their file names in
   `photos: ["file1.jpg", "file2.jpg"]`. The first one is the card picture.

To add another city, add its name to `LOCATIONS` at the top of `lands.js`.

## Privacy

Anything published with GitHub Pages is visible to anyone who has the link,
even from a private repository. Do not put registry documents, Aadhaar/PAN
numbers or anything else sensitive in this folder.
