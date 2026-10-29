// Offer Email Writer: settings you can change.
// After a change, save the file. Netlify puts the new version live in about one minute.

// The Claude model. Robin never chooses it.
export const MODEL = "claude-sonnet-5-5";

// How hard the model thinks: "low", "medium" or "high".
// Higher is slower and costs more.
export const EFFORT_GENERATE = "medium";
export const EFFORT_EDIT = "low";

// Most web searches for one email. Each search costs about 1 US cent.
export const MAX_SEARCHES = 5;

// Target length of the email in words, for one product.
// Each extra product adds the "extra" number of words.
// Robin never sees these numbers.
export const LENGTH_WORDS = {
  short: { base: 150, extraPerProduct: 75 },
  medium: { base: 300, extraPerProduct: 150 },
  long: { base: 450, extraPerProduct: 200 },
};

// The product list. "en" is the English name, "de" is the German name.
// To add a product: copy one line, give it a new id (small letters, no spaces) and change the names.
// To remove a product: delete its line.
export const PRODUCT_GROUPS = [
  {
    id: "home",
    en: "Home, liability and law",
    de: "Wohnen, Haftung und Recht",
    products: [
      { id: "personal_liability", en: "Personal liability", de: "Privathaftpflichtversicherung" },
      { id: "household_contents", en: "Household contents", de: "Hausratversicherung" },
      { id: "legal_protection", en: "Legal protection", de: "Rechtsschutzversicherung" },
      { id: "building", en: "Building insurance", de: "Wohngebäudeversicherung" },
      { id: "glass", en: "Glass", de: "Glasversicherung" },
      { id: "bicycle", en: "Bicycle", de: "Fahrradversicherung" },
      { id: "rental_deposit", en: "Rental deposit guarantee", de: "Mietkautionsversicherung" },
      { id: "property_owner_liability", en: "Property owner liability", de: "Haus- und Grundbesitzerhaftpflichtversicherung" },
      { id: "builder_liability", en: "Builder liability", de: "Bauherrenhaftpflichtversicherung" },
    ],
  },
  {
    id: "pets",
    en: "Pets",
    de: "Tiere",
    products: [
      { id: "dog_liability", en: "Dog owner liability", de: "Hundehalterhaftpflichtversicherung" },
      { id: "horse_liability", en: "Horse owner liability", de: "Pferdehalterhaftpflichtversicherung" },
      { id: "pet_health", en: "Pet health", de: "Tierkrankenversicherung" },
    ],
  },
  {
    id: "vehicles",
    en: "Vehicles",
    de: "Fahrzeuge",
    products: [
      { id: "car", en: "Car insurance", de: "Kfz-Versicherung" },
      { id: "motorcycle", en: "Motorcycle", de: "Motorradversicherung" },
    ],
  },
  {
    id: "health",
    en: "Health and travel",
    de: "Gesundheit und Reise",
    products: [
      { id: "private_health", en: "Private health insurance", de: "Private Krankenversicherung" },
      { id: "supplementary_health", en: "Supplementary health", de: "Krankenzusatzversicherung" },
      { id: "dental", en: "Dental supplementary", de: "Zahnzusatzversicherung" },
      { id: "hospital", en: "Hospital supplementary", de: "Krankenhauszusatzversicherung" },
      { id: "sickness_allowance", en: "Daily sickness allowance", de: "Krankentagegeldversicherung" },
      { id: "care_supplement", en: "Long-term care supplement", de: "Pflegezusatzversicherung" },
      { id: "travel_health", en: "Travel health", de: "Auslandsreisekrankenversicherung" },
      { id: "trip_cancellation", en: "Trip cancellation", de: "Reiserücktrittsversicherung" },
    ],
  },
  {
    id: "life",
    en: "Income, life and pension",
    de: "Einkommen, Leben und Rente",
    products: [
      { id: "disability_income", en: "Disability income", de: "Berufsunfähigkeitsversicherung" },
      { id: "basic_abilities", en: "Basic abilities cover", de: "Grundfähigkeitsversicherung" },
      { id: "accident", en: "Accident", de: "Private Unfallversicherung" },
      { id: "term_life", en: "Term life", de: "Risikolebensversicherung" },
      { id: "care_pension", en: "Care pension", de: "Pflegerentenversicherung" },
      { id: "funeral", en: "Funeral cover", de: "Sterbegeldversicherung" },
      { id: "private_pension", en: "Private pension", de: "Private Rentenversicherung" },
      { id: "basic_pension", en: "Basic pension", de: "Basisrente" },
      { id: "children_savings", en: "Savings plan for children", de: "Kindervorsorge" },
      { id: "education_savings", en: "Education savings", de: "Ausbildungsversicherung" },
    ],
  },
];
