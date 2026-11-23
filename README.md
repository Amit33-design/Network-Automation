# Family Land Register

A one-page website for tracking family land, farm land, house land and flats / apartments in
Harpur (Bihar) and Greater Noida.

Live at https://amit33-design.github.io/Network-Automation/

## Using it

- **City filter** and **Land type filter** work together; "All" in both shows every record.
- Search matches name, address, khata / khesra number, owner and notes.
- Click a card for full details, all photographs and a Google Maps link.

## Adding and editing land (from the page)

1. Click **Connect to edit** once on each phone or computer and paste a GitHub
   access key (fine-grained token, this repository only, *Contents: Read and write*).
2. Click **+ Add land**, fill in the name, city, type and any details, pick photos, and **Save**.
3. To change a land or add more photos, open it and click **Edit / add photos**.
   The same screen has **Delete this land**.

Saves go into this branch (`gh-pages`): `lands.json` holds the details and
`photos/` holds the pictures. The website updates within a minute or two.

## Tracking features

- Photos keep the date (and GPS, when the phone provides it) they were taken, plus a caption; newest first.
- Each land can store exact coordinates ("Use my current location"), Bihar record fields (khata, khesra, thana, mauza, registry, dakhil-kharij, lagan), chauhaddi, and farming details.
- History notes per land, a Map view of all lands, a Missing info view, and Excel / full backups.

## Privacy

This page is public to anyone with the link. Do not upload registry documents,
Aadhaar/PAN numbers or anything else sensitive. The access key stays only in
the browser where it was entered; use "Disconnect this device" on shared devices.
