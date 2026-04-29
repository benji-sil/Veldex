export const VELDEX_FAMILIES = {
  SHIP_COMPONENTS: "ship_components",
  SHIP_WEAPON: "ship_weapon",
  PLAYER_GEAR: "player_gear",
  INDUSTRIAL_EQUIPMENT: "industrial_equipment",
  RESOURCE: "resource",
  OTHER: "other"
};

export const VELDEX_LABELS = {
  [VELDEX_FAMILIES.SHIP_COMPONENTS]: "Composant vaisseau",
  [VELDEX_FAMILIES.SHIP_WEAPON]: "Arme vaisseau",
  [VELDEX_FAMILIES.PLAYER_GEAR]: "Équipement joueur",
  [VELDEX_FAMILIES.INDUSTRIAL_EQUIPMENT]: "Équipement industriel",
  [VELDEX_FAMILIES.RESOURCE]: "Ressource / Minerai",
  [VELDEX_FAMILIES.OTHER]: "Autre"
};

export function detectVeldexItemFamily(item, attributes = []) {
  const cat = (item.category || "").toLowerCase();
  const sec = (item.section || "").toLowerCase();
  const name = (item.name || "").toLowerCase();

  const match = (keywords) => keywords.some(k => cat.includes(k) || sec.includes(k));
  const nameMatch = (keywords) => keywords.some(k => name.includes(k));

  // 1. isCommodity === true -> Ressource / Minerai
  if (
    item.isCommodity === true || 
    cat === "commodity" || 
    ((item.type || "").toLowerCase() === "resource" && item.isCommodity === true)
  ) {
    return {
      family: VELDEX_FAMILIES.RESOURCE,
      subtype: item.section || "Metal / Mineral",
      label: VELDEX_LABELS[VELDEX_FAMILIES.RESOURCE]
    };
  }

  // 2. Mining / Salvage -> Équipement industriel
  const indusKeywords = ["mining module", "mining laser", "mining", "salvage", "scraper"];
  if (match(indusKeywords) || nameMatch(indusKeywords)) {
    let subtype = "Industrial";
    if (match(["mining module"]) || nameMatch(["mining module"])) subtype = "Mining Module";
    else if (match(["mining laser"]) || nameMatch(["mining laser"])) subtype = "Mining Laser";
    else if (match(["salvage"]) || nameMatch(["salvage"]) || match(["scraper"]) || nameMatch(["scraper"])) subtype = "Salvage";
    else subtype = "Mining";
    
    return {
      family: VELDEX_FAMILIES.INDUSTRIAL_EQUIPMENT,
      subtype: subtype,
      label: VELDEX_LABELS[VELDEX_FAMILIES.INDUSTRIAL_EQUIPMENT]
    };
  }

  // 3. Telescope Pod -> Équipement joueur / Attachment FPS
  if (name.includes("telescope pod")) {
    return {
      family: VELDEX_FAMILIES.PLAYER_GEAR,
      subtype: "Attachment FPS",
      label: VELDEX_LABELS[VELDEX_FAMILIES.PLAYER_GEAR]
    };
  }

  // 4. Module / Pod / Mount / Gimbal / Turret Mount -> Composant vaisseau / Module
  const moduleKeywords = ["module", "pod", "mount", "gimbal", "turret mount"];
  if (match(moduleKeywords) || nameMatch(moduleKeywords)) {
    return {
      family: VELDEX_FAMILIES.SHIP_COMPONENTS,
      subtype: "Module",
      label: VELDEX_LABELS[VELDEX_FAMILIES.SHIP_COMPONENTS]
    };
  }

  // 5. Attachments FPS classiques
  const fpsAttachmentKeywords = ["scope", "suppressor", "magazine", "sight", "optic", "attachment"];
  if (match(fpsAttachmentKeywords) || nameMatch(fpsAttachmentKeywords)) {
    return {
      family: VELDEX_FAMILIES.PLAYER_GEAR,
      subtype: "Attachment FPS",
      label: VELDEX_LABELS[VELDEX_FAMILIES.PLAYER_GEAR]
    };
  }

  // 6. Player gear classique
  const gearKeywords = ["personal weapon", "arms", "helmet", "torso", "legs", "undersuit", "backpack"];
  const isFPSWeaponName = name.match(/\b(p4-ar|rifle|pistol|sniper|smg|shotgun)\b/i);

  if (match(gearKeywords) || isFPSWeaponName) {
    let subtype = "Gear";
    if (match(["personal weapon"]) || isFPSWeaponName) subtype = "Arme FPS";
    else {
      const found = gearKeywords.find(k => cat.includes(k) || sec.includes(k));
      if (found) subtype = "Armure / " + found.charAt(0).toUpperCase() + found.slice(1);
    }
    return {
      family: VELDEX_FAMILIES.PLAYER_GEAR,
      subtype: subtype,
      label: VELDEX_LABELS[VELDEX_FAMILIES.PLAYER_GEAR]
    };
  }

  // 7a. Guns / Vehicle Weapons / Ship Weapons (avant ship_components génériques)
  // Ne doit PAS matcher les personal weapons / FPS déjà catégorisés
  const shipWeaponKeywords = ["gun", "vehicle weapon", "ship weapon", "laser cannon", "laser repeater", "ballistic cannon", "ballistic repeater", "mass driver", "neutron cannon", "plasma cannon", "distortion cannon", "emp"];
  const isFPSCat = match(["personal weapon", "arms"]) || match(fpsAttachmentKeywords);
  if (!isFPSCat && (match(shipWeaponKeywords) || nameMatch(shipWeaponKeywords))) {
    let subtype = "Gun";
    if (match(["vehicle weapon"]) || sec.includes("vehicle weapon")) subtype = "Vehicle Weapon";
    else if (match(["ship weapon"])) subtype = "Ship Weapon";
    else if (match(["gun"]) || cat.includes("gun")) subtype = "Gun";
    return {
      family: VELDEX_FAMILIES.SHIP_WEAPON,
      subtype,
      label: VELDEX_LABELS[VELDEX_FAMILIES.SHIP_WEAPON]
    };
  }

  // 7b. Ship components classiques
  const shipKeywords = ["cooler", "shield generator", "shield", "power plant", "quantum drive"];
  if (match(shipKeywords) || name.includes("winter-star")) {
    let subtype = "Ship Component";
    if (match(["cooler"]) || name.includes("winter-star")) subtype = "Cooler";
    else if (match(["shield generator", "shield"])) subtype = "Shield Generator";
    else if (match(["power plant"])) subtype = "Power Plant";
    else if (match(["quantum drive"])) subtype = "Quantum Drive";

    return {
      family: VELDEX_FAMILIES.SHIP_COMPONENTS,
      subtype: subtype,
      label: VELDEX_LABELS[VELDEX_FAMILIES.SHIP_COMPONENTS]
    };
  }

  // 8. fallback
  return {
    family: VELDEX_FAMILIES.OTHER,
    subtype: cat || "Inconnu",
    label: VELDEX_LABELS[VELDEX_FAMILIES.OTHER]
  };
}
