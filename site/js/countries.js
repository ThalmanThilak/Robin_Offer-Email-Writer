// All countries as ISO codes. The browser gives the names in English or German.
// India comes first because most of Robin's clients come from India.

const CODES = (
  "IN AF AX AL DZ AS AD AO AI AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BR " +
  "IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO " +
  "EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT " +
  "VA HN HK HU IS ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR XK KW KG LA LV LB LS LR LY LI LT " +
  "LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG " +
  "NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM " +
  "ST SA SN RS SC SL SG SX SK SI SB SO ZA SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN " +
  "TR TM TC TV UG UA AE GB US UY UZ VU VE VN VG VI WF EH YE ZM ZW"
).split(" ");

function namer(lang) {
  try {
    return new Intl.DisplayNames([lang], { type: "region" });
  } catch {
    return { of: (code) => code };
  }
}

const englishNames = namer("en");

// Returns [{ code, name }] with India first, the rest sorted by name in that language.
export function countryList(lang) {
  const names = namer(lang);
  const collator = new Intl.Collator(lang);
  const [first, ...rest] = CODES.map((code) => ({ code, name: names.of(code) || code }));
  rest.sort((a, b) => collator.compare(a.name, b.name));
  return [first, ...rest];
}

// Finds the ISO code for a name typed in English or German. Returns "" if none matches.
export function codeForName(text) {
  const wanted = text.trim().toLocaleLowerCase();
  if (!wanted) return "";
  for (const lang of ["en", "de"]) {
    const names = namer(lang);
    for (const code of CODES) {
      if ((names.of(code) || "").toLocaleLowerCase() === wanted) return code;
    }
  }
  return "";
}

export function englishCountryName(code) {
  return englishNames.of(code) || code;
}

export function localCountryName(code, lang) {
  return namer(lang).of(code) || code;
}
