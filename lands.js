/*
 * FAMILY LAND RECORDS — edit this file to add or change land.
 *
 * Each land is one { ... } block. Copy a block, change the values, save.
 *
 *   location : "Harpur, Bihar"  or  "Greater Noida"   (must match LOCATIONS below)
 *   type     : "Family land" | "Farm land" | "House land"
 *   photos   : file names inside the photos/ folder, e.g. ["harpur-farm-1.jpg"]
 *   mapLink  : optional Google Maps link (leave "" to search by address)
 *
 * The three entries below are SAMPLES ONLY — replace them with your real land.
 */

const LOCATIONS = ["Harpur, Bihar", "Greater Noida"];
const TYPES = ["Family land", "Farm land", "House land"];

const LANDS = [
  {
    name: "Sample — Ancestral family plot",
    location: "Harpur, Bihar",
    type: "Family land",
    area: "0 bigha 0 katha",
    address: "Replace with full address — Village Harpur, Post, Block, District, Bihar, PIN",
    khata: "",
    khesra: "",
    owner: "",
    status: "",
    notes: "Sample entry. Replace with real details.",
    mapLink: "",
    photos: [],
  },
  {
    name: "Sample — Farm land",
    location: "Harpur, Bihar",
    type: "Farm land",
    area: "0 bigha 0 katha",
    address: "Replace with full address — Village Harpur, Post, Block, District, Bihar, PIN",
    khata: "",
    khesra: "",
    owner: "",
    status: "",
    notes: "Sample entry. Crop, tenant/bataidar, irrigation, boundaries etc. can go here.",
    mapLink: "",
    photos: [],
  },
  {
    name: "Sample — House plot",
    location: "Greater Noida",
    type: "House land",
    area: "0 sq. m",
    address: "Replace with full address — Plot no., Sector, Greater Noida, Uttar Pradesh, PIN",
    khata: "",
    khesra: "",
    owner: "",
    status: "",
    notes: "Sample entry. Allotment / registry details can go here.",
    mapLink: "",
    photos: [],
  },
];
