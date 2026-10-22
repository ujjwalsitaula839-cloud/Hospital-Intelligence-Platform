// Interior photo for each room type, from /public/rooms. Similar rooms share one photo.
const BY_TYPE = {
  "ICU — Single": "icu",
  "Med/Surg — Single": "medsurg",
  "Support room": "medsurg",
  "Operating room": "or",
  Scrub: "scrub",
  "Sterile core": "sterile",
  "Sterile storage": "sterile",
  "Prep and pack": "sterile",
  "MRI suite": "mri",
  "CT suite": "ct",
  "X-ray": "xray",
  Control: "control",
  "ED — Trauma": "trauma",
  "ED — Exam": "ed-exam",
  "Fast track": "ed-exam",
  Observation: "ed-exam",
  Triage: "triage",
  Pharmacy: "pharmacy",
  "Floor pharmacy": "pharmacy",
  "Medication room": "meds",
  "Nurse station": "nurse",
  "Staff station": "nurse",
  "Waiting room": "waiting",
  "Family waiting": "waiting",
  "Clinic waiting": "waiting",
  "Exam room": "exam",
  "Staff lounge": "lounge",
  Equipment: "equipment",
  Storage: "storage",
  "General stores": "storage",
  "Clean utility": "utility",
  "Soiled utility": "utility",
  "Post-anesthesia recovery": "pacu",
  "PT gym": "pt",
  Restroom: "restroom",
  Conference: "conference",
  "Board room": "conference",
  "Medical director": "office",
  "Open office": "office",
  Registration: "registration",
  "Ambulance bay": "ems",
  "Loading dock": "dock",
  "Stat lab": "lab",
  "Resuscitation support": "resus",
  Decontamination: "decontam",
  Mechanical: "mechanical",
  "Body holding": "morgue",
  Linen: "linen",
};

const BY_DEPT = { icu: "icu", med: "medsurg", surgward: "medsurg", ed: "ed-exam", surgery: "or" };

// Elevators and stairs have no interior worth showing.
export function roomPhoto(room) {
  if (!room || room.kind === "elevator" || room.kind === "stair") return null;
  if (room.id === "ADMIN") return "/team-pic.jpg";
  const key = BY_TYPE[room.type] || BY_DEPT[room.dept] || "medsurg";
  return `/rooms/${key}.png`;
}
