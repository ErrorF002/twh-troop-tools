/**
 * Leader Contacts Export
 *
 * Reads the Active Roster CSV and outputs a contacts file for
 * adult leaders only. Two formats supported:
 *
 *   google  — Google Contacts CSV, importable at contacts.google.com
 *   iphone  — vCard (.vcf) with all contacts in one file, tap-to-import on iOS
 *
 * Field mapping from TroopWebHost roster:
 *   Name        → FIrst Name / Middle Name / Last Name / Suffix (note header typo)
 *   Phones      → Cell Phone, Home Phone, Business Phone (in that priority order)
 *   Email       → Email, Email #2
 *   Address     → Mailing Address Line 1/2, City, State, Zip Code
 *   Notes       → Spouse name if present
 *   Org         → user-supplied Organization Name input
 *   Label       → same as Organization Name
 */

const fs = require("fs");
const path = require("path");
const { parseCSV } = require("../shared/csv-parser");
const { todayISO } = require("../shared/dates");

// ═══════════════════════════════ MANIFEST ═══════════════════════════════
const manifest = {
  id: "contacts",
  name: "Troop Contacts Export",
  description: "Exports adult leaders from the active roster into a contacts file. Import directly into Google Contacts or tap to import on iPhone.",
  icon: "📇",
  inputs: [
    {
      key: "roster",
      label: "Active Roster CSV",
      hint: "Export: Membership → Export Membership Data → Export Active Roster To Excel",
      required: true,
      twhReport: "roster",
    },
  ],
  options: [
    {
      key: "orgName",
      label: "Organization Name",
      type: "text",
      placeholder: "BSA Troop NNN",
      required: true,
    },
    {
      key: "format",
      label: "Download Format",
      type: "radio",
      choices: [
        { value: "google", label: "Google Contacts (.csv)" },
        { value: "iphone", label: "iPhone (.vcf)" },
      ],
      default: "google",
    },
  ],
};

// ═══════════════════════════════ DATA LOADING ════════════════════════════
function loadAdults(rosterPath) {
  const rows = parseCSV(fs.readFileSync(rosterPath, "utf8"));
  return rows
    .filter(r => r.Adult === "Y")
    .map(r => {
      // TWH has a typo: "FIrst Name" instead of "First Name"
      const firstName = (r["FIrst Name"] || r["First Name"] || "").trim();
      const middleName = (r["Middle Name"] || "").trim();
      const lastName = (r["Last Name"] || "").trim();
      const suffix = (r["Suffix"] || "").trim();
      const cell = normalizePhone(r["Cell Phone"]);
      const home = normalizePhone(r["Home Phone"]);
      const business = normalizePhone(r["Business Phone"]);
      const email1 = (r["Email"] || "").trim();
      const email2 = (r["Email #2"] || "").trim();
      const street1 = (r["Mailing Address Line 1"] || "").trim();
      const street2 = (r["Mailing Address Line 2"] || "").trim();
      const city = (r["City"] || "").trim();
      const state = (r["State"] || "").trim();
      const zip = (r["Zip Code"] || "").trim();
      const spouse = (r["Spouse"] || "").trim();

      return {
        firstName, middleName, lastName, suffix,
        cell, home, business,
        email1, email2,
        street1, street2, city, state, zip,
        spouse,
      };
    })
    .filter(r => r.firstName || r.lastName); // skip blank rows
}

// Normalize phone to digits only, return empty string if unusable
function normalizePhone(raw) {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits : "";
}

// Format a 10-digit number as E.164 (+1XXXXXXXXXX) for VCF
function toE164(digits) {
  if (!digits) return "";
  const d = digits.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === "1") return `+${d}`;
  return d;
}

// ═══════════════════════════════ GOOGLE CSV ═══════════════════════════════
const GOOGLE_HEADERS = [
  "Name Prefix", "First Name", "Middle Name", "Last Name", "Name Suffix",
  "Phonetic First Name", "Phonetic Middle Name", "Phonetic Last Name",
  "Nickname", "File As",
  "E-mail 1 - Label", "E-mail 1 - Value",
  "E-mail 2 - Label", "E-mail 2 - Value",
  "Phone 1 - Label", "Phone 1 - Value",
  "Phone 2 - Label", "Phone 2 - Value",
  "Phone 3 - Label", "Phone 3 - Value",
  "Address 1 - Label", "Address 1 - Country",
  "Address 1 - Street", "Address 1 - Extended Address",
  "Address 1 - City", "Address 1 - Region",
  "Address 1 - Postal Code", "Address 1 - PO Box",
  "Organization Name", "Organization Title", "Organization Department",
  "Birthday",
  "Event 1 - Label", "Event 1 - Value",
  "Relation 1 - Label", "Relation 1 - Value",
  "Website 1 - Label", "Website 1 - Value",
  "Custom Field 1 - Label", "Custom Field 1 - Value",
  "Notes", "Labels",
];

function buildGoogleCSV(adults, orgName) {
  const csvEscape = v => {
    if (!v) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const lines = [GOOGLE_HEADERS.join(",")];

  adults.forEach(a => {
    const phones = [];
    if (a.cell) phones.push(["Cell", a.cell]);
    if (a.home) phones.push(["Home", a.home]);
    if (a.business) phones.push(["Work", a.business]);

    const notes = a.spouse ? `Spouse: ${a.spouse}` : "";

    const row = {
      "First Name": a.firstName,
      "Middle Name": a.middleName,
      "Last Name": a.lastName,
      "Name Suffix": a.suffix,
      "E-mail 1 - Label": a.email1 ? "Home" : "",
      "E-mail 1 - Value": a.email1,
      "E-mail 2 - Label": a.email2 ? "Home" : "",
      "E-mail 2 - Value": a.email2,
      "Phone 1 - Label": phones[0] ? phones[0][0] : "",
      "Phone 1 - Value": phones[0] ? phones[0][1] : "",
      "Phone 2 - Label": phones[1] ? phones[1][0] : "",
      "Phone 2 - Value": phones[1] ? phones[1][1] : "",
      "Phone 3 - Label": phones[2] ? phones[2][0] : "",
      "Phone 3 - Value": phones[2] ? phones[2][1] : "",
      "Address 1 - Label": (a.street1 || a.city) ? "Home" : "",
      "Address 1 - Country": (a.street1 || a.city) ? "US" : "",
      "Address 1 - Street": a.street1,
      "Address 1 - Extended Address": a.street2,
      "Address 1 - City": a.city,
      "Address 1 - Region": a.state,
      "Address 1 - Postal Code": a.zip,
      "Organization Name": orgName,
      "Notes": notes,
      "Labels": orgName,
    };

    lines.push(GOOGLE_HEADERS.map(h => csvEscape(row[h] || "")).join(","));
  });

  return lines.join("\r\n");
}

// ═══════════════════════════════ VCARD (.vcf) ═════════════════════════════
function vcfEscape(s) {
  return (s || "").replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function buildVCF(adults, orgName) {
  return adults.map(a => {
    const lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `N:${vcfEscape(a.lastName)};${vcfEscape(a.firstName)};${vcfEscape(a.middleName)};;${vcfEscape(a.suffix)}`,
      `FN:${vcfEscape([a.firstName, a.middleName, a.lastName, a.suffix].filter(Boolean).join(" "))}`,
      `ORG:${vcfEscape(orgName)}`,
    ];

    if (a.cell) lines.push(`TEL;TYPE=CELL,VOICE:${toE164(a.cell)}`);
    if (a.home) lines.push(`TEL;TYPE=HOME,VOICE:${toE164(a.home)}`);
    if (a.business) lines.push(`TEL;TYPE=WORK,VOICE:${toE164(a.business)}`);
    if (a.email1) lines.push(`EMAIL;TYPE=HOME:${a.email1}`);
    if (a.email2) lines.push(`EMAIL;TYPE=HOME:${a.email2}`);

    if (a.street1 || a.city) {
      // VCF ADR format: PO Box;Extended;Street;City;Region;Postal;Country
      lines.push(
        `ADR;TYPE=HOME:;;${vcfEscape(a.street1)};${vcfEscape(a.city)};${vcfEscape(a.state)};${vcfEscape(a.zip)};US`
      );
    }

    if (a.spouse) lines.push(`NOTE:Spouse: ${vcfEscape(a.spouse)}`);
    if (orgName) lines.push(`CATEGORIES:${vcfEscape(orgName)}`);

    lines.push("END:VCARD");
    return lines.join("\r\n");
  }).join("\r\n");
}

// ═══════════════════════════════ MAIN ENTRY POINT ════════════════════════
async function generate(inputs, outputDir, options = {}) {
  const { roster: rosterPath } = inputs;
  if (!rosterPath || !fs.existsSync(rosterPath)) {
    throw new Error("Roster CSV not provided");
  }

  const orgName = (options.orgName || "").trim();
  if (!orgName) throw new Error("Organization Name is required");

  const format = options.format || "google";
  const adults = loadAdults(rosterPath);

  let content, fileName, ext;
  if (format === "iphone") {
    content = buildVCF(adults, orgName);
    ext = "vcf";
    fileName = `${orgName.replace(/[^a-zA-Z0-9]/g, "_")}_Contacts_${todayISO()}.vcf`;
  } else {
    content = buildGoogleCSV(adults, orgName);
    ext = "csv";
    fileName = `${orgName.replace(/[^a-zA-Z0-9]/g, "_")}_Contacts_${todayISO()}.csv`;
  }

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, fileName);
  fs.writeFileSync(filePath, content, "utf8");

  return {
    filePath,
    fileName,
    stats: {
      leaders: adults.length,
      format: format === "iphone" ? "iPhone VCF" : "Google Contacts CSV",
    },
  };
}

module.exports = { manifest, generate };
