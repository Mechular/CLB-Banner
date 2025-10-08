  const debugON = false;
  
  // === CALL WINDOW CONFIG (adjust as needed) ===
  const CALL_RULES = {
    CALL_START_HOUR: 8,        // inclusive (0–23) callee local hour
    CALL_END_HOUR: 20,         // exclusive (0–23) callee local hour
    BLOCK_WEEKENDS: true,      // disallow Sat/Sun by callee local time
    ALLOW_UNKNOWN_TZ: false,   // block if timezone can’t be resolved
    WARN_ONLY: true,           // true = confirm instead of block
    SHOW_BADGE: true           // show TZ/time badge in Phone cell
  };
  
  // Keep your original isWithinCallHours working by syncing globals it reads
  (function applyCallWindowGlobalsFromConfig(){
    try {
      (typeof window !== "undefined" ? window : globalThis).CALL_START_HOUR = CALL_RULES.CALL_START_HOUR;
      (typeof window !== "undefined" ? window : globalThis).CALL_END_HOUR   = CALL_RULES.CALL_END_HOUR;
    } catch {}
  })();
  
  // ---------- Helpers ----------
  function getAreaFromPhone(num) {
    const digits = String(num).replace(/\D/g, "").replace(/^1/, "");
    return digits.slice(0, 3);
  }
  
  function isWeekend(dateObj) {
    if (!(dateObj instanceof Date)) return false;
    const d = dateObj.getDay(); // 0=Sun..6=Sat
    return d === 0 || d === 6;
  }
  
  function isCallableByPolicy(localTimeStr, localDateObj) {
    // honor your existing hour rule
    const hourOk = isWithinCallHours(localTimeStr);
    // optional weekend rule
    const weekendOk = CALL_RULES.BLOCK_WEEKENDS ? !isWeekend(localDateObj) : true;
    return hourOk && weekendOk;
  }
  
  const CALL_UI = {
    okColor:   "#16a34a",
    warnColor: "#f59e0b",
    blockColor:"#dc2626",
    badgeBg:   "rgba(0,0,0,0.06)",
    badgeText: "#111827"
  };
  
  function upsertTimeBadge(phoneCell, tzLabel, localTime, callable, unknownTz) {
    if (!CALL_RULES.SHOW_BADGE) return;
    let badge = phoneCell.querySelector(".call-time-badge");
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "call-time-badge";
      badge.style.cssText = `
        display:inline-block;margin-left:6px;padding:1px 6px;border-radius:10px;
        font-size:11px;line-height:16px;background:${CALL_UI.badgeBg};
        color:${CALL_UI.badgeText};vertical-align:middle;
      `;
      phoneCell.appendChild(badge);
    }
    const stateColor = unknownTz ? CALL_UI.warnColor : (callable ? CALL_UI.okColor : CALL_UI.blockColor);
    badge.style.border = `1px solid ${stateColor}`;
    badge.textContent = `${tzLabel || "TZ?"} ${localTime || "Unknown"}`;
    badge.title = callable
      ? "Within call window"
      : unknownTz
      ? "Timezone unknown. Check before calling."
      : "Outside call window";
  }
  
  // Wrapper so you DON'T have to modify your existing getAreaCodeInfo()
  function getAreaCodeInfoWithDate(areaCode) {
    const [loc, tzLabel, localTime] = getAreaCodeInfo(areaCode) || [];
    let localDate = null;
  
    if (tzLabel && tzLabel !== "Unknown") {
      const base = tzLabel.replace(/DT$/, "ST"); // EDT->EST, CDT->CST, etc.
      const offsetMap = { EST:-5, CST:-6, MST:-7, PST:-8, AKST:-9, HST:-10, AST:-4, NST:-3.5, ChST:10 };
      if (Object.prototype.hasOwnProperty.call(offsetMap, base)) {
        let finalOffset = offsetMap[base] + (tzLabel.endsWith("DT") ? 1 : 0);
        const now = new Date();
        const utc = now.getTime() + now.getTimezoneOffset() * 60000;
        localDate = new Date(utc + finalOffset * 3600000);
      }
    }
  
    return [loc, tzLabel, localTime, localDate];
  }
  
  // === Feature toggles ===
  let ENABLE_MYSTATS_WIDGET = true;
  let ENABLE_BANNER_UPDATE = true;
  let ENABLE_DATA_EXTRACTION = true;
  let ENABLE_DATA_FIELD_POPULATION = true;
  let ENABLE_NOTES_TAB_CLICK = true;
  let ENABLE_NOTIFICATIONS_CLEAR = true;
  let ENABLE_PAGE_LEAVE_CLEAR = true;
  let ENABLE_VOICEMAIL_MENU = true;
  let ENABLE_SCRIPT_MENU = true;
  let ENABLE_AUTOHIDE_DIAL_SUMMARY = true;
  let ENABLE_AUTO_DISPOSITION = true;
  let ENABLE_CLEANUP_SIDEBAR_WIDGETS = true;
  let ENABLE_TIME_RESTRICTION = true;
  let ENABLE_GET_USER_DATA = true;
  let ENABLE_RETURN_SCRUBBED_INPUTS = true;
  let ENABLE_UPDATE_INPUTS = true;
  let ENABLE_MENU_BUTTONS = true;
  let ENABLE_EXTRACT_CONTACT_DATA = true;
  let ENABLE_SHRINK_SMS_HEIGHT = true;
  let ENABLE_AUTO_SMS_POST_CALL = true;
  let ENABLE_SHOW_TIMESTAMPS = true;
  let ENABLE_SIDEBAR_URL_CHANGE = true;
  let ENABLE_MONITOR_URL_CHANGES = true; // core function. do not disable!
  
  // === State variables ===
  let initialized = false;
  let notesScrollInitialized = false;
  let hasClickedNotesTab = false;
  let storedAddress = '';
  let wasOnContactPage = true;
  let myStatsAdded = false;
  let bannerDismissed = false;
  let tooltip;
  let voicemailLink;
  let lastBaseUrl = getBaseContactUrl(location.href);
  
  let bannerTextLeft = '';
  let bannerTextCenterLeft = '';
  let bannerTextCenterRight = '';
  let bannerTextRight = '';
  let lastBannerTextLeft = '';
  let lastBannerTextCenterLeft = '';
  let lastBannerTextCenterRight = '';
  let lastBannerTextRight = '';
  let localTimeZone = '';
  let noteBlock = null;
  let iterationCount = 0;
  let hasRunExtractNoteData = false;
  
  let jsonData = [];
  
  // Helper: securely set value on an input so events fire properly
  function setInputValueSecurely(input, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    nativeInputValueSetter.call(input, value);
  
    // Dispatch proper events so the page reacts
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  
  // Your secure typing function
  const simulateSecureTyping = async (input, targetValue, dly = 25) => {
    if (!(input instanceof HTMLInputElement)) return;
  
    let typed = '';
    for (const char of targetValue) {
      typed += char;
      setInputValueSecurely(input, typed);
      input.focus();
  
      if (typed.length >= targetValue.length - 3) {
        await delay(dly);
      }
    }
    return typed;
  };
  
  const stateAbbreviations = {
      "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
      "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA",
      "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA",
      "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
      "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO",
      "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ",
      "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH",
      "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
      "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
      "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY"
  };
  
  const removeIfExists = (id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
  };
  
  function cLog(text) {
      if (!debugON) return;
      console.log(`[${new Date().toLocaleTimeString()}] ${text}`);
      // type = log, warn, error
  }
  
  function cWarn(text) {
      if (!debugON) return;
      console.warn(`[${new Date().toLocaleTimeString()}] ${text}`);
      // type = log, warn, error
  }
  
  function cErr(text) {
      if (!debugON) return;
      console.error(`[${new Date().toLocaleTimeString()}] ${text}`);
      // type = log, warn, error
  }
  
  function delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  function normalize(str) {
      return str.replace(/[\r\n]+/g, '').trim().toLowerCase();
  }
  
  // Check if current page is a contact detail page
  function isOnContactPage(url) {
      if (!url) return;
      return url.includes('/contacts/detail/');
  }
  
  // Check if current page is a contact detail page
  function isOnConversationsPage(url) {
      if (!url) return;
      return url.includes('/conversations/conversations/');
  }
  
  function getBaseContactUrl(url) {
      return url.split('?')[0];
  }
  
  // Helper: determine if a string is all upper or all lower
  function isAllCapsOrAllLower(str) {
      return str === str.toUpperCase() || str === str.toLowerCase();
  }
  
  // Helper: check for invalid city characters
  function hasBadCityCharacters(str) {
      return /[^a-zA-Z\s'-]/.test(str); // allow letters, spaces, hyphens, apostrophes
  }
  
  // Optional: helper to strip time like "9:13 PM (CDT)" from string
  function stripTime(str) {
      return str.replace(/\d{1,2}:\d{2}\s*(AM|PM)\s*\(.*?\)/gi, '').trim();
  }
  
  // Helper: remove invalid city characters (keep letters, spaces, hyphens, apostrophes)
  function cleanCharacters(str) {
      return str.replace(/[^a-zA-Z\s'-]/g, '');
  }
  
  function getStreetName(addressLine1) {
      if (!addressLine1) return '';
  
      return addressLine1
          .split(',')[0]                  // Keep only before the first comma
          .replace(/^\d+\s*/, '')         // Remove leading house number
          .replace(/\.$/, '')             // Remove trailing period
          .replace(/\s+/g, ' ')           // Collapse extra spaces
          .trim();                        // Final cleanup
  }
  
  function normalizeAddress(address) {
      if (!address || typeof address !== "string") return address;
  
      // Split address into parts: street, rest
      const [rawStreet, ...restParts] = address.split(',');
      const rest = restParts.join(',').trim();
  
      const directionals = {
          "north": "N", "south": "S", "east": "E", "west": "W",
          "northeast": "NE", "northwest": "NW", "southeast": "SE", "southwest": "SW"
      };
  
      const suffixes = {
          "alley": "Aly", "annex": "Anx", "arcade": "Arc", "avenue": "Ave", "bayou": "Byu", "beach": "Bch",
          "bend": "Bnd", "bluff": "Blf", "bluffs": "Blfs", "bottom": "Btm", "boulevard": "Blvd", "branch": "Br",
          "bridge": "Brg", "brook": "Brk", "brooks": "Brks", "burg": "Bg", "burgs": "Bgs", "bypass": "Byp",
          "camp": "Cp", "canyon": "Cyn", "cape": "Cpe", "causeway": "Cswy", "center": "Ctr", "centers": "Ctrs",
          "circle": "Cir", "circles": "Cirs", "cliff": "Clf", "cliffs": "Clfs", "club": "Clb", "common": "Cmn",
          "commons": "Cmns", "corner": "Cor", "corners": "Cors", "course": "Crse", "court": "Ct", "courts": "Cts",
          "cove": "Cv", "coves": "Cvs", "creek": "Crk", "crescent": "Cres", "crest": "Crst", "crossing": "Xing",
          "crossroad": "Xrd", "curve": "Curv", "dale": "Dl", "dam": "Dm", "divide": "Dv", "drive": "Dr",
          "drives": "Drs", "estate": "Est", "estates": "Ests", "expressway": "Expy", "extension": "Ext",
          "extensions": "Exts", "fall": "Fall", "falls": "Fls", "ferry": "Fry", "field": "Fld", "fields": "Flds",
          "flat": "Flt", "flats": "Flts", "ford": "Frd", "fords": "Frds", "forest": "Frst", "forge": "Frg",
          "forges": "Frgs", "fork": "Frk", "forks": "Frks", "fort": "Ft", "freeway": "Fwy", "garden": "Gdn",
          "gardens": "Gdns", "gateway": "Gtwy", "glen": "Gln", "glens": "Glns", "green": "Grn", "greens": "Grns",
          "grove": "Grv", "groves": "Grvs", "harbor": "Hbr", "harbors": "Hbrs", "haven": "Hvn", "heights": "Hts",
          "highway": "Hwy", "hill": "Hl", "hills": "Hls", "hollow": "Holw", "inlet": "Inlt", "island": "Is",
          "islands": "Iss", "isle": "Isle", "junction": "Jct", "junctions": "Jcts", "key": "Ky", "keys": "Kys",
          "knoll": "Knl", "knolls": "Knls", "lake": "Lk", "lakes": "Lks", "landing": "Lndg", "lane": "Ln",
          "light": "Lgt", "lights": "Lgts", "loaf": "Lf", "lock": "Lck", "locks": "Lcks", "lodge": "Ldg",
          "loop": "Loop", "mall": "Mall", "manor": "Mnr", "manors": "Mnrs", "meadow": "Mdw", "meadows": "Mdws",
          "mews": "Mews", "mill": "Ml", "mills": "Mls", "mission": "Msn", "motorway": "Mtwy", "mount": "Mt",
          "mountain": "Mtn", "mountains": "Mtns", "neck": "Nck", "orchard": "Orch", "oval": "Oval", "overpass": "Opas",
          "park": "Park", "parks": "Parks", "parkway": "Pkwy", "parkways": "Pkwys", "pass": "Pass", "passage": "Psge",
          "path": "Path", "pike": "Pike", "pine": "Pne", "pines": "Pnes", "place": "Pl", "plain": "Pln",
          "plains": "Plns", "plaza": "Plz", "point": "Pt", "points": "Pts", "port": "Prt", "ports": "Prts",
          "prairie": "Pr", "radial": "Radl", "ramp": "Ramp", "ranch": "Rnch", "rapid": "Rpd", "rapids": "Rpds",
          "rest": "Rst", "ridge": "Rdg", "ridges": "Rdgs", "river": "Riv", "road": "Rd", "roads": "Rds", "route": "Rte",
          "row": "Row", "rue": "Rue", "run": "Run", "shoal": "Shl", "shoals": "Shls", "shore": "Shr", "shores": "Shrs",
          "skyway": "Skwy", "spring": "Spg", "springs": "Spgs", "spur": "Spur", "spurs": "Spurs", "square": "Sq",
          "squares": "Sqs", "station": "Sta", "stravenue": "Stra", "stream": "Strm", "street": "St", "streets": "Sts",
          "summit": "Smt", "terrace": "Ter", "throughway": "Trwy", "trace": "Trce", "track": "Trak", "trafficway": "Trfy",
          "trail": "Trl", "trailer": "Trlr", "tunnel": "Tunl", "turnpike": "Tpke", "underpass": "Upas", "union": "Un",
          "unions": "Uns", "valley": "Vly", "valleys": "Vlys", "viaduct": "Via", "view": "Vw", "views": "Vws",
          "village": "Vlg", "villages": "Vlgs", "ville": "Vl", "vista": "Vis", "walk": "Walk", "walks": "Walks",
          "wall": "Wall", "way": "Way", "well": "Wl", "wells": "Wls"
      };
  
      const wordBoundaryReplace = (text, map) => {
          const pattern = new RegExp(`\\b(${Object.keys(map).join("|")})\\b`, "gi");
          return text.replace(pattern, (match) => map[match.toLowerCase()] || match);
      };
  
      const titleCase = (str) =>
      str.replace(/\w\S*/g, (word) =>
                  /^(NE|NW|SE|SW|N|S|E|W|PO|RR|HC|FM|US|TX|MO|IL|NY|CA)$/i.test(word)
                  ? word.toUpperCase()
                  : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                 );
  
      // Normalize and title-case street only
      let street = rawStreet.trim();
      street = wordBoundaryReplace(street, directionals);
      street = wordBoundaryReplace(street, suffixes);
      street = titleCase(street);
  
      // Return full normalized address
      return [street, rest].filter(Boolean).join(', ');
  }
  
  // const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  function clickToNextContact() {
      const labelBlock = document.querySelector('.d-inline-block.text-xs.text-gray-900');
      if (labelBlock) {
          const innerBlock = labelBlock.querySelector('.d-inline-block');
  
          if (innerBlock) {
              const clickToNextContact = innerBlock.querySelector('i.fa.fa-caret-right.--blue');
  
              if (clickToNextContact) {
                  const targetElement = clickToNextContact.parentElement;
  
                  // Wait for 3 seconds before clicking
                  delay(5000).then(() => {
                      targetElement.click();
                      console.log("Found parent of caret icon:", targetElement);
                  });
              }
          }
      }
  }
  
  
  function getAreaCodeInfo(areaCode) {
      const areaCodeMap = {
          "201": { timezone: "EST", location: "Northern New Jersey" },
          "202": { timezone: "EST", location: "Washington, DC" },
          "203": { timezone: "EST", location: "Southwestern Connecticut" },
          "204": { timezone: "CST", location: "Manitoba, Canada" },
          "205": { timezone: "CST", location: "Western and Central Alabama" },
          "206": { timezone: "PST", location: "Seattle, WA" },
          "207": { timezone: "EST", location: "Maine" },
          "208": { timezone: "MST", location: "Idaho" },
          "209": { timezone: "PST", location: "Central California" },
          "210": { timezone: "CST", location: "San Antonio, TX" },
          "212": { timezone: "EST", location: "New York City, NY" },
          "213": { timezone: "PST", location: "Los Angeles, CA" },
          "214": { timezone: "CST", location: "Dallas, TX" },
          "215": { timezone: "EST", location: "Philadelphia, PA" },
          "216": { timezone: "EST", location: "Cleveland, OH" },
          "217": { timezone: "CST", location: "Central Illinois" },
          "218": { timezone: "CST", location: "Northern Minnesota" },
          "219": { timezone: "CST", location: "Northwestern Indiana" },
          "224": { timezone: "CST", location: "Northern Illinois (suburbs of Chicago)" },
          "225": { timezone: "CST", location: "Baton Rouge, LA" },
          "226": { timezone: "EST", location: "Southwestern Ontario, Canada" },
          "228": { timezone: "CST", location: "Coastal Mississippi" },
          "229": { timezone: "EST", location: "Southwestern Georgia" },
          "231": { timezone: "EST", location: "Northwestern Michigan" },
          "234": { timezone: "EST", location: "Northeastern Ohio" },
          "236": { timezone: "PST", location: "British Columbia, Canada" },
          "239": { timezone: "EST", location: "Southwestern Florida" },
          "240": { timezone: "EST", location: "Western Maryland" },
          "242": { timezone: "EST", location: "The Bahamas" },
          "246": { timezone: "AST", location: "Barbados" },
          "248": { timezone: "EST", location: "Oakland County, Michigan" },
          "250": { timezone: "PST", location: "Southern British Columbia, Canada" },
          "251": { timezone: "CST", location: "Mobile, Alabama" },
          "252": { timezone: "EST", location: "Northeastern North Carolina" },
          "253": { timezone: "PST", location: "Tacoma, Washington" },
          "254": { timezone: "CST", location: "Central Texas" },
          "256": { timezone: "CST", location: "Northern Alabama" },
          "260": { timezone: "EST", location: "Northeastern Indiana" },
          "262": { timezone: "CST", location: "Southeastern Wisconsin" },
          "264": { timezone: "AST", location: "Anguilla" },
          "267": { timezone: "EST", location: "Philadelphia suburbs, Pennsylvania" },
          "268": { timezone: "AST", location: "Antigua and Barbuda" },
          "269": { timezone: "EST", location: "Southwestern Michigan" },
          "270": { timezone: "CST", location: "Western Kentucky" },
          "272": { timezone: "EST", location: "Eastern Pennsylvania" },
          "274": { timezone: "CST", location: "Northern Wisconsin" },
          "276": { timezone: "EST", location: "Southwestern Virginia" },
          "278": { timezone: "EST", location: "Western Pennsylvania" },
          "281": { timezone: "CST", location: "Houston suburbs, Texas" },
          "283": { timezone: "CST", location: "Eastern Pennsylvania" },
          "289": { timezone: "EST", location: "Southern Ontario, Canada" },
          "301": { timezone: "EST", location: "Western Maryland" },
          "302": { timezone: "EST", location: "Delaware" },
          "303": { timezone: "MST", location: "Denver, Colorado" },
          "304": { timezone: "EST", location: "West Virginia" },
          "305": { timezone: "EST", location: "Miami, Florida" },
          "306": { timezone: "CST", location: "Saskatchewan, Canada" },
          "307": { timezone: "MST", location: "Wyoming" },
          "308": { timezone: "CST", location: "Western Nebraska" },
          "309": { timezone: "CST", location: "Central Illinois" },
          "310": { timezone: "PST", location: "West Los Angeles, California" },
          "312": { timezone: "CST", location: "Downtown Chicago, Illinois" },
          "313": { timezone: "EST", location: "Detroit, Michigan" },
          "314": { timezone: "CST", location: "St. Louis, Missouri" },
          "315": { timezone: "EST", location: "Central New York" },
          "316": { timezone: "CST", location: "Wichita, Kansas" },
          "317": { timezone: "EST", location: "Indianapolis, Indiana" },
          "318": { timezone: "CST", location: "Northwestern Louisiana" },
          "319": { timezone: "CST", location: "Eastern Iowa" },
          "320": { timezone: "CST", location: "Central Minnesota" },
          "321": { timezone: "EST", location: "Space Coast, Florida" },
          "323": { timezone: "PST", location: "East Los Angeles, California" },
          "325": { timezone: "CST", location: "West Central Texas" },
          "327": { timezone: "EST", location: "Eastern Pennsylvania" },
          "330": { timezone: "EST", location: "Northeastern Ohio" },
          "331": { timezone: "CST", location: "Western Illinois" },
          "334": { timezone: "CST", location: "Southeastern Alabama" },
          "336": { timezone: "EST", location: "Piedmont Triad, North Carolina" },
          "337": { timezone: "CST", location: "Southwestern Louisiana" },
          "339": { timezone: "EST", location: "Northeastern Massachusetts" },
          "340": { timezone: "AST", location: "U.S. Virgin Islands" },
          "343": { timezone: "EST", location: "Eastern Ontario, Canada" },
          "345": { timezone: "EST", location: "Cayman Islands" },
          "346": { timezone: "CST", location: "Houston, Texas" },
          "347": { timezone: "EST", location: "New York City suburbs" },
          "351": { timezone: "EST", location: "Northeastern Massachusetts" },
          "352": { timezone: "EST", location: "North Central Florida" },
          "360": { timezone: "PST", location: "Western Washington State" },
          "361": { timezone: "CST", location: "South Texas coast" },
          "364": { timezone: "CST", location: "Western Kentucky" },
          "365": { timezone: "EST", location: "Southern Ontario, Canada" },
          "380": { timezone: "EST", location: "Northeastern Ohio" },
          "385": { timezone: "MST", location: "Northern Utah" },
          "386": { timezone: "EST", location: "Northeastern Florida" },
          "401": { timezone: "EST", location: "Rhode Island" },
          "402": { timezone: "CST", location: "Eastern Nebraska" },
          "403": { timezone: "MST", location: "Southern Alberta, Canada" },
          "404": { timezone: "EST", location: "Atlanta, Georgia" },
          "405": { timezone: "CST", location: "Oklahoma City, Oklahoma" },
          "406": { timezone: "MST", location: "Montana" },
          "407": { timezone: "EST", location: "Orlando, Florida" },
          "408": { timezone: "PST", location: "San Jose, California" },
          "409": { timezone: "CST", location: "Southeast Texas" },
          "410": { timezone: "EST", location: "Baltimore, Maryland" },
          "412": { timezone: "EST", location: "Pittsburgh, Pennsylvania" },
          "413": { timezone: "EST", location: "Western Massachusetts" },
          "414": { timezone: "CST", location: "Milwaukee, Wisconsin" },
          "415": { timezone: "PST", location: "San Francisco, California" },
          "416": { timezone: "EST", location: "Toronto, Ontario, Canada" },
          "417": { timezone: "CST", location: "Southwestern Missouri" },
          "418": { timezone: "EST", location: "Eastern Quebec, Canada" },
          "419": { timezone: "EST", location: "Northwestern Ohio" },
          "423": { timezone: "EST", location: "Eastern Tennessee" },
          "424": { timezone: "PST", location: "Los Angeles, California" },
          "425": { timezone: "PST", location: "Seattle suburbs, Washington" },
          "430": { timezone: "CST", location: "Eastern Texas" },
          "431": { timezone: "CST", location: "Southern Manitoba, Canada" },
          "432": { timezone: "CST", location: "Western Texas" },
          "434": { timezone: "EST", location: "South Central Virginia" },
          "435": { timezone: "MST", location: "Western Utah" },
          "437": { timezone: "EST", location: "Toronto, Ontario, Canada" },
          "438": { timezone: "EST", location: "Montreal, Quebec, Canada" },
          "440": { timezone: "EST", location: "Western suburbs of Cleveland, Ohio" },
          "441": { timezone: "AST", location: "Bermuda" },
          "442": { timezone: "PST", location: "Southern California" },
          "443": { timezone: "EST", location: "Baltimore, Maryland suburbs" },
          "450": { timezone: "EST", location: "Southern Quebec, Canada" },
          "458": { timezone: "PST", location: "Oregon" },
          "463": { timezone: "EST", location: "Indianapolis suburbs, Indiana" },
          "464": { timezone: "EST", location: "Chicago suburbs, Illinois" },
          "469": { timezone: "CST", location: "Dallas suburbs, Texas" },
          "470": { timezone: "EST", location: "Atlanta suburbs, Georgia" },
          "473": { timezone: "AST", location: "Grenada" },
          "475": { timezone: "EST", location: "Connecticut" },
          "478": { timezone: "EST", location: "Central Georgia" },
          "479": { timezone: "CST", location: "Northwestern Arkansas" },
          "480": { timezone: "MST", location: "Eastern Phoenix suburbs, Arizona" },
          "484": { timezone: "EST", location: "Eastern Pennsylvania suburbs" },
          "501": { timezone: "CST", location: "Central Arkansas" },
          "502": { timezone: "EST", location: "Louisville, Kentucky" },
          "503": { timezone: "PST", location: "Portland, Oregon" },
          "504": { timezone: "CST", location: "New Orleans, Louisiana" },
          "505": { timezone: "MST", location: "New Mexico" },
          "506": { timezone: "AST", location: "New Brunswick, Canada" },
          "507": { timezone: "CST", location: "Southern Minnesota" },
          "508": { timezone: "EST", location: "Central Massachusetts" },
          "509": { timezone: "PST", location: "Eastern Washington" },
          "510": { timezone: "PST", location: "Oakland, California" },
          "512": { timezone: "CST", location: "Austin, Texas" },
          "513": { timezone: "EST", location: "Cincinnati, Ohio" },
          "514": { timezone: "EST", location: "Montreal, Quebec, Canada" },
          "515": { timezone: "CST", location: "Central Iowa" },
          "516": { timezone: "EST", location: "Nassau County, Long Island, NY" },
          "517": { timezone: "EST", location: "South Central Michigan" },
          "518": { timezone: "EST", location: "Eastern Upstate New York" },
          "519": { timezone: "EST", location: "Southwestern Ontario, Canada" },
          "520": { timezone: "MST", location: "Southern Arizona" },
          "530": { timezone: "PST", location: "Northern California" },
          "531": { timezone: "CST", location: "Eastern Nebraska" },
          "534": { timezone: "CST", location: "Eastern Wisconsin" },
          "539": { timezone: "CST", location: "Oklahoma" },
          "540": { timezone: "EST", location: "Western and Northern Virginia" },
          "541": { timezone: "PST", location: "Most of Oregon" },
          "548": { timezone: "EST", location: "Southern Ontario, Canada" },
          "551": { timezone: "EST", location: "Northern New Jersey" },
          "559": { timezone: "PST", location: "Central California" },
          "561": { timezone: "EST", location: "Palm Beach County, Florida" },
          "562": { timezone: "PST", location: "Southeast Los Angeles County, California" },
          "563": { timezone: "CST", location: "Eastern Iowa" },
          "564": { timezone: "PST", location: "Western Washington" },
          "567": { timezone: "EST", location: "Northwestern Ohio" },
          "570": { timezone: "EST", location: "Northeastern Pennsylvania" },
          "571": { timezone: "EST", location: "Northern Virginia" },
          "573": { timezone: "CST", location: "Eastern Missouri" },
          "574": { timezone: "EST", location: "Northern Indiana" },
          "575": { timezone: "MST", location: "Southern New Mexico" },
          "580": { timezone: "CST", location: "Southern and Western Oklahoma" },
          "585": { timezone: "EST", location: "Western New York" },
          "586": { timezone: "EST", location: "Macomb County, Michigan" },
          "587": { timezone: "MST", location: "Alberta, Canada" },
          "601": { timezone: "CST", location: "Central Mississippi" },
          "602": { timezone: "MST", location: "Phoenix, Arizona" },
          "603": { timezone: "EST", location: "New Hampshire" },
          "604": { timezone: "PST", location: "Vancouver, British Columbia, Canada" },
          "605": { timezone: "CST", location: "South Dakota" },
          "606": { timezone: "EST", location: "Eastern Kentucky" },
          "607": { timezone: "EST", location: "Southern Central New York" },
          "608": { timezone: "CST", location: "Southwestern Wisconsin" },
          "609": { timezone: "EST", location: "Southern New Jersey" },
          "610": { timezone: "EST", location: "Eastern Pennsylvania" },
          "612": { timezone: "CST", location: "Minneapolis, Minnesota" },
          "613": { timezone: "EST", location: "Ottawa, Ontario, Canada" },
          "614": { timezone: "EST", location: "Columbus, Ohio" },
          "615": { timezone: "CST", location: "Nashville, Tennessee" },
          "616": { timezone: "EST", location: "Grand Rapids, Michigan" },
          "617": { timezone: "EST", location: "Boston, Massachusetts" },
          "618": { timezone: "CST", location: "Southern Illinois" },
          "619": { timezone: "PST", location: "San Diego, California" },
          "620": { timezone: "CST", location: "Southern Kansas" },
          "623": { timezone: "MST", location: "Western Phoenix suburbs, Arizona" },
          "626": { timezone: "PST", location: "Pasadena, California" },
          "628": { timezone: "PST", location: "San Francisco Bay Area, California" },
          "629": { timezone: "CST", location: "Middle Tennessee" },
          "630": { timezone: "CST", location: "Chicago suburbs, Illinois" },
          "631": { timezone: "EST", location: "Eastern Suffolk County, Long Island, NY" },
          "636": { timezone: "CST", location: "Western St. Louis suburbs, Missouri" },
          "639": { timezone: "EST", location: "Saskatchewan, Canada" },
          "641": { timezone: "CST", location: "Central Iowa" },
          "646": { timezone: "EST", location: "New York City, NY" },
          "647": { timezone: "EST", location: "Toronto, Ontario, Canada" },
          "650": { timezone: "PST", location: "San Mateo County, California" },
          "651": { timezone: "CST", location: "St. Paul, Minnesota" },
          "657": { timezone: "CST", location: "Orange County, California" },
          "660": { timezone: "CST", location: "Northwestern Missouri" },
          "661": { timezone: "PST", location: "Bakersfield, California" },
          "662": { timezone: "CST", location: "Northern Mississippi" },
          "667": { timezone: "EST", location: "Baltimore, Maryland" },
          "669": { timezone: "PST", location: "San Jose, California" },
          "670": { timezone: "ChST", location: "Guam" },
          "671": { timezone: "ChST", location: "Northern Mariana Islands" },
          "678": { timezone: "EST", location: "Atlanta suburbs, Georgia" },
          "682": { timezone: "CST", location: "Fort Worth, Texas" },
          "701": { timezone: "CST", location: "North Dakota" },
          "702": { timezone: "PST", location: "Las Vegas, Nevada" },
          "703": { timezone: "EST", location: "Northern Virginia" },
          "704": { timezone: "EST", location: "Charlotte, North Carolina" },
          "705": { timezone: "EST", location: "Northern Ontario, Canada" },
          "706": { timezone: "EST", location: "Northwestern Georgia" },
          "707": { timezone: "PST", location: "Northern California" },
          "708": { timezone: "CST", location: "Chicago suburbs, Illinois" },
          "709": { timezone: "NST", location: "Newfoundland and Labrador, Canada" },
          "712": { timezone: "CST", location: "Western Iowa" },
          "713": { timezone: "CST", location: "Houston, Texas" },
          "714": { timezone: "PST", location: "Orange County, California" },
          "715": { timezone: "CST", location: "Northern Wisconsin" },
          "716": { timezone: "EST", location: "Buffalo, New York" },
          "717": { timezone: "EST", location: "South Central Pennsylvania" },
          "718": { timezone: "EST", location: "New York City boroughs" },
          "719": { timezone: "MST", location: "Colorado Springs, Colorado" },
          "720": { timezone: "MST", location: "Denver suburbs, Colorado" },
          "724": { timezone: "EST", location: "Western Pennsylvania" },
          "725": { timezone: "PST", location: "Las Vegas suburbs, Nevada" },
          "727": { timezone: "EST", location: "St. Petersburg, Florida" },
          "730": { timezone: "CST", location: "Central Illinois" },
          "731": { timezone: "CST", location: "Western Tennessee" },
          "732": { timezone: "EST", location: "Central New Jersey" },
          "734": { timezone: "EST", location: "Washtenaw County, Michigan" },
          "737": { timezone: "CST", location: "Austin, Texas" },
          "740": { timezone: "EST", location: "Southeastern Ohio" },
          "747": { timezone: "PST", location: "Los Angeles suburbs, California" },
          "754": { timezone: "EST", location: "Broward County, Florida" },
          "757": { timezone: "EST", location: "Virginia Peninsula" },
          "760": { timezone: "PST", location: "Eastern Riverside County, California" },
          "762": { timezone: "EST", location: "Western Georgia" },
          "763": { timezone: "CST", location: "Northwestern suburbs of Minneapolis" },
          "765": { timezone: "EST", location: "Central Indiana" },
          "769": { timezone: "CST", location: "Central Mississippi" },
          "770": { timezone: "EST", location: "Atlanta suburbs, Georgia" },
          "772": { timezone: "EST", location: "Treasure Coast, Florida" },
          "773": { timezone: "CST", location: "Chicago, Illinois" },
          "774": { timezone: "EST", location: "Central Massachusetts" },
          "775": { timezone: "PST", location: "Northern Nevada" },
          "778": { timezone: "PST", location: "British Columbia, Canada" },
          "779": { timezone: "CST", location: "Northern Illinois" },
          "780": { timezone: "MST", location: "Northern Alberta, Canada" },
          "781": { timezone: "EST", location: "Eastern Massachusetts suburbs" },
          "782": { timezone: "AST", location: "Nova Scotia, Canada" },
          "784": { timezone: "AST", location: "Saint Vincent and the Grenadines" },
          "785": { timezone: "CST", location: "Northern Kansas" },
          "786": { timezone: "EST", location: "Miami-Dade County, Florida" },
          "787": { timezone: "AST", location: "Puerto Rico" },
          "801": { timezone: "MST", location: "Salt Lake City, Utah" },
          "802": { timezone: "EST", location: "Vermont" },
          "803": { timezone: "EST", location: "Central South Carolina" },
          "804": { timezone: "EST", location: "Eastern Virginia" },
          "805": { timezone: "PST", location: "Central Coast of California" },
          "806": { timezone: "CST", location: "Texas Panhandle" },
          "807": { timezone: "EST", location: "Northwestern Ontario, Canada" },
          "808": { timezone: "HST", location: "Hawaii" },
          "810": { timezone: "EST", location: "Eastern Michigan" },
          "812": { timezone: "EST", location: "Southern Indiana" },
          "813": { timezone: "EST", location: "Tampa, Florida" },
          "814": { timezone: "EST", location: "Northwestern Pennsylvania" },
          "815": { timezone: "CST", location: "Northern Illinois" },
          "816": { timezone: "CST", location: "Kansas City, Missouri" },
          "817": { timezone: "CST", location: "Fort Worth, Texas" },
          "818": { timezone: "PST", location: "San Fernando Valley, California" },
          "819": { timezone: "EST", location: "Western Quebec, Canada" },
          "825": { timezone: "MST", location: "Southern Alberta, Canada" },
          "828": { timezone: "EST", location: "Western North Carolina" },
          "829": { timezone: "AST", location: "Dominican Republic" },
          "830": { timezone: "CST", location: "South Central Texas" },
          "831": { timezone: "PST", location: "Central Coast, California" },
          "832": { timezone: "CST", location: "Houston, Texas" },
          "843": { timezone: "EST", location: "Coastal South Carolina" },
          "845": { timezone: "EST", location: "Hudson Valley, New York" },
          "847": { timezone: "CST", location: "Northern Illinois suburbs" },
          "848": { timezone: "EST", location: "Central New Jersey" },
          "849": { timezone: "AST", location: "Dominican Republic" },
          "850": { timezone: "CST", location: "Florida Panhandle" },
          "856": { timezone: "EST", location: "Southwestern New Jersey" },
          "857": { timezone: "EST", location: "Boston, Massachusetts" },
          "858": { timezone: "PST", location: "Northern San Diego, California" },
          "859": { timezone: "EST", location: "Northern Kentucky" },
          "860": { timezone: "EST", location: "Central Connecticut" },
          "862": { timezone: "EST", location: "Northern New Jersey" },
          "863": { timezone: "EST", location: "Central Florida" },
          "864": { timezone: "EST", location: "Upstate South Carolina" },
          "865": { timezone: "EST", location: "Knoxville, Tennessee" },
          "867": { timezone: "MST", location: "Yukon, Northwest Territories, Nunavut" },
          "868": { timezone: "AST", location: "Trinidad and Tobago" },
          "869": { timezone: "AST", location: "Saint Kitts and Nevis" },
          "870": { timezone: "CST", location: "Eastern Arkansas" },
          "872": { timezone: "CST", location: "Chicago, Illinois" },
          "873": { timezone: "EST", location: "Southern Quebec, Canada" },
          "878": { timezone: "EST", location: "Western Pennsylvania" },
          "901": { timezone: "CST", location: "Memphis, Tennessee" },
          "902": { timezone: "AST", location: "Nova Scotia and Prince Edward Island, Canada" },
          "903": { timezone: "CST", location: "Northeastern Texas" },
          "904": { timezone: "EST", location: "Jacksonville, Florida" },
          "905": { timezone: "EST", location: "Greater Toronto Area, Canada" },
          "906": { timezone: "EST", location: "Upper Peninsula, Michigan" },
          "907": { timezone: "AKST", location: "Alaska" },
          "908": { timezone: "EST", location: "Central New Jersey" },
          "909": { timezone: "PST", location: "Inland Empire, California" },
          "910": { timezone: "EST", location: "Southeastern North Carolina" },
          "912": { timezone: "EST", location: "Coastal Georgia" },
          "913": { timezone: "CST", location: "Kansas City suburbs, Kansas" },
          "914": { timezone: "EST", location: "Westchester County, New York" },
          "915": { timezone: "MST", location: "El Paso, Texas" },
          "916": { timezone: "PST", location: "Sacramento, California" },
          "917": { timezone: "EST", location: "New York City, NY" },
          "918": { timezone: "CST", location: "Northeastern Oklahoma" },
          "919": { timezone: "EST", location: "Raleigh, North Carolina" },
          "920": { timezone: "CST", location: "Eastern Wisconsin" },
          "925": { timezone: "PST", location: "East Bay, California" },
          "928": { timezone: "MST", location: "Northern and Western Arizona" },
          "929": { timezone: "EST", location: "New York City suburbs" },
          "930": { timezone: "CST", location: "Southern Illinois" },
          "931": { timezone: "CST", location: "Middle Tennessee" },
          "934": { timezone: "EST", location: "Eastern Long Island, NY" },
          "936": { timezone: "CST", location: "Southeast Texas" },
          "937": { timezone: "EST", location: "Dayton, Ohio" },
          "938": { timezone: "CST", location: "Central Alabama" },
          "939": { timezone: "AST", location: "Puerto Rico" },
          "940": { timezone: "CST", location: "Northern Texas" },
          "941": { timezone: "EST", location: "Southwest Florida" },
          "947": { timezone: "EST", location: "Detroit, Michigan" },
          "949": { timezone: "PST", location: "Southern Orange County, California" },
          "951": { timezone: "PST", location: "Inland Empire, California" },
          "952": { timezone: "CST", location: "Suburban Minneapolis, Minnesota" },
          "954": { timezone: "EST", location: "Broward County, Florida" },
          "956": { timezone: "CST", location: "Southern Texas" },
          "959": { timezone: "EST", location: "Connecticut" },
          "970": { timezone: "MST", location: "Northern Colorado" },
          "971": { timezone: "PST", location: "Northwestern Oregon" },
          "972": { timezone: "CST", location: "Dallas, Texas" },
          "973": { timezone: "EST", location: "Northern New Jersey" },
          "978": { timezone: "EST", location: "Northeastern Massachusetts" },
          "979": { timezone: "CST", location: "Southeastern Texas" },
          "980": { timezone: "EST", location: "Charlotte suburbs, North Carolina" },
          "984": { timezone: "EST", location: "Raleigh suburbs, North Carolina" },
          "985": { timezone: "CST", location: "Southeastern Louisiana" },
          "986": { timezone: "EST", location: "Eastern Washington" },
          "989": { timezone: "EST", location: "Northeastern Michigan" }
      };
  
      const timezoneOffsets = {
          "EST": -5,
          "CST": -6,
          "MST": -7,
          "PST": -8,
          "AKST": -9,
          "HST": -10,
          "AST": -4,
          "NST": -3.5,
          "ChST": 10
      };
  
      const code = String(areaCode).replace(/\D/g, "").slice(0, 3);
      const info = areaCodeMap[code] || { timezone: "Unknown", location: "Unknown" };
      const baseOffset = timezoneOffsets[info.timezone];
  
      let localTime = "Unknown time";
      let tzLabel = info.timezone;
  
      if (baseOffset !== undefined) {
          const now = new Date();
          const jan = new Date(now.getFullYear(), 0, 1);
          const jul = new Date(now.getFullYear(), 6, 1);
  
          const stdTimezoneOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
          const isLocalDST = now.getTimezoneOffset() < stdTimezoneOffset;
  
          const usesDST = !info.location.includes(", AZ") && info.timezone !== "HST";
  
          const isDST = usesDST && isLocalDST;
          const finalOffset = baseOffset + (isDST ? 1 : 0);
  
          const utc = now.getTime() + now.getTimezoneOffset() * 60000;
          const local = new Date(utc + finalOffset * 3600000);
  
          const options = { hour: "numeric", minute: "2-digit", hour12: true };
          localTime = local.toLocaleTimeString("en-US", options);
  
          tzLabel = info.timezone.replace("ST", isDST ? "DT" : "ST");
      }
  
      // return `${info.location} (${tzLabel}) - ${localTime}`;
      return [info.location, tzLabel, localTime];
  
  }
  
  function clickTab(tabName) {
      const rightDetails = document.querySelector('div.hl_contact-details-right');
      if (!rightDetails) {
          cLog('🔍 .hl_contact-details-right container not found');
          return;
      }
  
      const tab = rightDetails.querySelector(`[aria-controls="${tabName}"]`);
      if (!tab) {
          cLog(`🔍 Tab with aria-controls="${tabName}" not found`);
          return;
      }
  
      const isVisible = tab.offsetParent !== null || tab.getBoundingClientRect().height > 0;
      if (isVisible) {
          cLog(`✅ Clicking ${tabName} tab`);
          tab.click();
      } else {
          cLog(`⏳ ${tabName} tab found but not visible yet`);
      }
  }
  
  function toProperCase(str) {
      return str.replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  }
  
  function closeOtherMenus(currentId) {
      const ids = ['tb_addnote_menu', 'tb_script_menu', 'tb_sms_menu', 'tb_voicemail_menu', 'tb_email_menu'];
      ids.forEach(id => {
          if (id !== currentId) {
              const menu = document.getElementById(id)?.querySelector('div[role="menu"]');
              if (menu) menu.classList.add('hidden');
          }
      });
  }
  
  function setDisposition(value, preReq = false) {
      const select = document.querySelector('select[name="contact.call_disposal_automations"]');
    
      if (!select) {
          cWarn('Select element not found.');
          return;
      }
  
      if (value === "Move to Contacted") {
          if (document.querySelector('select[name="contact.call_disposal_automations"]').value !== "") {
              console.log("setDisposition: preReq not met.");
              return;
          }
      }
  
      if (preReq !== false) {
      }
  
      // If preReq is provided, ensure it matches
      if (preReq && select && select.value !== preReq) {
          cErr('Cannot set disposition. Prerequisite not met');
          return;
      }
  
      // Set the disposition value
      select.value = value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
         
      cLog('Disposition set successfully');
  }
  
  
  
  function setSecondaryDisposition() {
      if (!location.href.includes('/contacts/detail/')) return;
    
      const select = document.querySelector('select[name="contact.call_disposal_automations"]');
      const select2 = document.querySelector('select[name="contact.pipeline_stage_name"]');
      const select3 = document.querySelector('select[name="contact.has_the_property_been_listed_with_a_realtor"]');
      const select4 = document.querySelector('select[name="contact.send_to_dispositions"]');
  
      // Ensure we always have targets
      if (!select2 || !select3 || !select4) {
        console.warn('Missing select2, select3, or select4');
        return;
      }
  
      let pipelineStageName = '';
      let realtorStageName = 'No';
      let sendOfferOwner = false;
      let sendOfferDispo = "";
      let value = select.value;
    
      if (value === "Move to Contacted" || value === "Move to Final Contact" || value === "Move to Analyzing" || value === "Move to Hot Lead" || value === "Move to Nurture" || value === "Wholesaler") {
        pipelineStageName = "Contacted";
      } else if (value === "Move to Initial Offer Made") {
        pipelineStageName = "Initial Offer Made";
      } else if (value === "Move to Offer Accepted") {
        sendOfferDispo = "Yes";
        pipelineStageName = "Offer Accepted";
      } else if (value === "Listed with Agent") {
        realtorStageName = "Yes";
        pipelineStageName = "Dead";
      } else {
        pipelineStageName = "Dead";
      }
      
      // 1) Compute values (give pipeline a default)
      if (!pipelineStageName) {
        pipelineStageName = 'Dead'; // <-- set the fallback you actually want
      }
      
      // 2) Vanilla helper: set by label or value and fire events
      function setSelectByLabelOrValue(selectEl, labelOrValue) {
        if (!selectEl || !labelOrValue) return;
      
        const opts = Array.from(selectEl.options);
        const match =
          opts.find(o => o.text.trim() === labelOrValue) ||
          opts.find(o => o.value === labelOrValue);
      
        if (!match) {
          console.warn('No matching option for', labelOrValue);
          return;
        }
      
        // Only update if needed
        if (selectEl.value !== match.value) {
          selectEl.value = match.value;
      
          // Fire the events most UIs listen for
          selectEl.dispatchEvent(new Event('input',  { bubbles: true }));
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    
        const checkbox = document.querySelector('input[name="contact.send_offer"]');
        if (checkbox && checkbox.checked !== sendOfferOwner) {
          checkbox.checked = sendOfferOwner;
        }
      
      // 3) Apply
      setSelectByLabelOrValue(select2, pipelineStageName);
      setSelectByLabelOrValue(select3, realtorStageName); 
      setSelectByLabelOrValue(select4, sendOfferDispo);
  
  }
  
  function getDisposition() {
      const el = document.querySelector('div[class="filter-option-inner-inner"]');
  
      if (!el) {
          // cWarn('Select element not found.');
          return '';
      }
      return el.innerText.trim();
  }
  
  
  async function scrubInputValue(selector) {
      const el = document.querySelector(selector);
      if (!el) {
          if (debugON) cErr("Not Found :: " + selector);
          return ''; // Return an empty string if the element isn't found
      }
  
      let originalText = el.value;
      let text = originalText;
  
      const excludedPhrases = ["unknown", "not sure", "see comments", "()", "not given", "unkown", "uknown", "nan"];
      excludedPhrases.forEach(phrase => {
          const regex = new RegExp(phrase, "gi");
          text = text.replace(regex, "");
      });
  
      const cleaned = text.trim();
  
      if (debugON && cleaned === '') {
          cLog(`Scrubbed input "${originalText}" from ${selector} → result: empty string`);
      }
  
      return cleaned;
  }
  
  function clickAndWaitForChange(element, container) {
      return new Promise((resolve) => {
          const observer = new MutationObserver(() => {
              observer.disconnect();
              resolve();
          });
  
          observer.observe(container, {
              childList: true,
              subtree: true,
          });
  
          element.click();
      });
  }
  
  function tagExists(tagName) {
      // Open tags container
      const container = document.querySelector('.hl_wrapper.hl_contact--details');
  
      if (container) {
          // Check if any div has "Primary"
          const hasPrimary = Array.from(container.querySelectorAll('div.py-2'))
          .some(div => div.innerText.trim() === "Primary");
  
          // If not, click the "Opportunities" span
          if (!hasPrimary) {
              const span = Array.from(container.querySelectorAll('span'))
              .find(s => s.innerText.trim() === "Opportunities");
  
              if (span) {
                  span.click();
              }
          }
      }
  
      // Look for the tag that includes the disposition text
      const contactedTags = document.querySelectorAll('.tag');
  
      for (const tag of contactedTags) {
          if (tag.innerText.includes(tagName)) {
              cLog(`Found tag including "${tagName}":`, tag.innerText.trim());
              return true;
          }
      }
  
      // cLog(`No tag found including "${tagName}".`);
      return false;
  }
  
  
  function attachTooltip(el, disable = false, message = '') {
      // return;
      if (!el) return;
  
      // If user already manually re-enabled this element, skip future disabling
      if (disable && el.dataset.tooltipEnabled === "true") {
          return;
      }
  
      // Create tooltip if not already in DOM
      let tooltip = document.getElementById('tb-tooltip');
      if (!tooltip) {
          tooltip = document.createElement('div');
          tooltip.id = 'tb-tooltip';
          Object.assign(tooltip.style, {
              position: 'fixed',
              zIndex: '9998',
              background: 'black',
              color: 'white',
              padding: '5px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              display: 'none',
          });
          document.body.appendChild(tooltip);
      }
  
      // Clean up any previous overlay
      const oldOverlay = el.parentElement.querySelector('.tb-tooltip-overlay');
      if (oldOverlay) oldOverlay.remove();
  
      if (!disable) {
          // Force enable manually
          el.classList.remove('disable-call');
          el.style.opacity = '';
          el.style.cursor = '';
          el.style.pointerEvents = '';
          delete el.dataset.tooltipEnabled;
          return;
      }
  
      // Disable the element visually and functionally
      el.classList.add('disable-call');
      el.style.opacity = '0.5';
      el.style.cursor = 'not-allowed';
      el.style.pointerEvents = 'none';
  
      // Ensure parent is relatively positioned
      const parent = el.parentElement;
      if (getComputedStyle(parent).position === 'static') {
          parent.style.position = 'relative';
      }
  
      // Create overlay to handle tooltip and right-click
      const overlay = document.createElement('span');
      overlay.className = 'tb-tooltip-overlay';
  
      const rect = el.getBoundingClientRect();
      const offsetTop = el.offsetTop;
      const offsetLeft = el.offsetLeft;
  
      Object.assign(overlay.style, {
          position: 'absolute',
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          top: `${offsetTop}px`,
          left: `${offsetLeft}px`,
          zIndex: '9998',
          pointerEvents: 'auto',
          background: 'transparent',
      });
  
      // Tooltip behavior
      overlay.addEventListener('mouseenter', e => {
          tooltip.textContent = message;
          tooltip.style.left = `${e.pageX + 10}px`;
          tooltip.style.top = `${e.pageY + 10}px`;
          tooltip.style.display = 'block';
      });
  
      overlay.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
      });
  
      // don't re-enable if Email Templates menu
      if (!el.innerText.includes("Email Templates")) {
          // Right-click to re-enable
          overlay.addEventListener('contextmenu', e => {
              e.preventDefault();
  
              el.classList.remove('disable-call');
              el.style.opacity = '';
              el.style.cursor = '';
              el.style.pointerEvents = '';
              el.dataset.tooltipEnabled = "true"; // Persist re-enable until reload
  
              overlay.remove();
              tooltip.style.display = 'none';
          });
      }
  
      parent.appendChild(overlay);
  }
  
  function detachTooltip(el) {
      if (!el) return;
  
      // Remove disabling styles and class
      if (el.classList.contains('disable-call')) {
          el.classList.remove('disable-call');
      }
  
      if (el.style.opacity) {
          el.style.opacity = '';
      }
  
      if (el.style.cursor) {
          el.style.cursor = '';
      }
  
      if (el.style.pointerEvents) {
          el.style.pointerEvents = '';
      }
  
      if (el.disabled) {
          el.disabled = false;
      }
  
      if (el.dataset.tooltipEnabled) {
          delete el.dataset.tooltipEnabled;
      }
  
      // Remove overlay if it exists
      const overlay = el.parentElement?.querySelector('.tb-tooltip-overlay');
      if (overlay) {
          overlay.remove();
      }
  
      // Hide tooltip if visible
      const tooltip = document.getElementById('tb-tooltip');
      if (tooltip) {
          tooltip.style.display = 'none';
      }
  }

function timeRestriction() {
  if (!ENABLE_TIME_RESTRICTION) return;

  const sellerPhoneInput = document.querySelector('[name="contact.phone"]');
  const banner = document.getElementById("notification_banner-top_bar");

  // Defaults
  let earliestHour = 8;
  let latestHour = 20;
  let isRestricted = true; // fail-safe default
  let isDNC = false;

  // Compute isDNC (case-insensitive) without early return
  if (sellerPhoneInput) {
    const tags = (sellerPhoneInput.dataset.tags || '').toLowerCase();
    isDNC = tags.includes('dnc') || tags.includes('do not contact');
  }

  // Compute isRestricted if we can parse local time
  const sellerPhone = sellerPhoneInput ? (sellerPhoneInput.value || '') : '';
  const infoArray = getAreaCodeInfo(sellerPhone);
  if (Array.isArray(infoArray) && infoArray.length >= 3) {
    const localTimeStr = String(infoArray[2] || '').trim();

    // Try 12-hour with AM/PM anywhere (e.g., "5:07 AM", "5:07 AM EDT")
    let hour = null;
    let m = localTimeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
    if (m) {
      hour = parseInt(m[1], 10);
      const period = m[3].toUpperCase();
      if (period === 'PM' && hour !== 12) hour += 12;
      if (period === 'AM' && hour === 12) hour = 0;
    } else {
      // Try 24-hour "HH:MM" (e.g., "17:30")
      m = localTimeStr.match(/\b(\d{1,2}):(\d{2})\b/);
      if (m) {
        const h24 = parseInt(m[1], 10);
        if (h24 >= 0 && h24 <= 23) hour = h24;
      }
    }

    if (hour !== null) {
      isRestricted = hour < earliestHour || hour >= latestHour;
    } // else keep fail-safe restricted = true
  }

  // Resolve buttons every poll (works across contact/account switches)
  const callBtn = document.querySelector('.message-header-actions.contact-detail-actions')?.children?.[0] || null;
  const smsBtn = document.querySelector('#send-sms') || document.querySelector('.send-message-button-group-sms-modal') || null;

  // Apply UI (no early returns)
  if (isDNC) {
    const dncMsg = 'This contact has opted out.';
    if (callBtn) attachTooltip(callBtn, true, dncMsg);
    if (smsBtn) attachTooltip(smsBtn, true, dncMsg);

    if (ENABLE_BANNER_UPDATE && banner) {
      banner.style.backgroundColor = 'rgb(252, 164, 18)';
      banner.style.color = 'white';
    }
  } else if (isRestricted) {
    const callMsg = 'Too early/late to call (right click to re-enable)';
    const smsMsg  = 'Too early/late to text (right click to re-enable)';

    if (callBtn) attachTooltip(callBtn, true, callMsg);
    if (smsBtn) attachTooltip(smsBtn, true, smsMsg);

    if (ENABLE_BANNER_UPDATE && banner) {
      if (banner.style.backgroundColor !== 'rgb(252, 164, 18)') banner.style.backgroundColor = 'rgb(252, 164, 18)';
      if (banner.style.color !== 'white') banner.style.color = 'white';
    }
  } else {
    // Allowed window: clear any previous disabled state/tooltips
    if (callBtn) attachTooltip(callBtn, false, '');
    if (smsBtn) attachTooltip(smsBtn, false, '');

    if (ENABLE_BANNER_UPDATE && banner) {
      if (banner.style.backgroundColor !== 'rgb(208, 248, 171)') banner.style.backgroundColor = 'rgb(208, 248, 171)';
      if (banner.style.color !== 'black') banner.style.color = 'black';
    }
  }
}


  async function getUserData() {
      if (!ENABLE_GET_USER_DATA) return;
  
      let myFirstName = '';
      let myLastName = '';
      let myInitials = '';
      let myEmail = '';
      let myTele = '';
  
      // Get user info (name, email, initials)
      const dropdown = document.querySelector('.hl_header--dropdown.dropdown.--no-caret');
      if (!dropdown) {
          cErr('User dropdown not found.');
          return {};
      }
  
      const container = dropdown.querySelector('.inline-block.w-56.px-2.py-1.text-sm.break-all.dark\\:text-white');
      if (!container) {
          cErr('User info container not found.');
          return {};
      }
  
      const nameEl = container.querySelector('.text-gray-900');
      const emailEl = container.querySelector('.text-xs.text-gray-900.truncate');
  
      const fullName = nameEl ? nameEl.textContent.trim() : '';
      myEmail = emailEl ? emailEl.textContent.trim() : '';
  
      if (fullName) {
          const parts = fullName.split(' ').filter(Boolean);
          myFirstName = parts[0] || '';
          myLastName = parts.slice(1).join(' ') || '';
          myInitials = ((myFirstName[0] || '') + (myLastName[0] || '')).toUpperCase();
      }
  
      // Get user phone number
      const dialer = document.querySelector('.dialer');
      if (dialer) {
        myTele = `+`+dialer.querySelector('.flex.cursor-pointer.items-center.gap-2')?.querySelectorAll('.ui-text-sm-medium')[0]?.textContent.split("+")[1].trim();
          if (myTele) {
              const cleanedTele = myTele.replace(/\+1|\D/g, '');
              if (cleanedTele.length === 10) {
                  myTele = `(${cleanedTele.slice(0, 3)}) ${cleanedTele.slice(3, 6)}-${cleanedTele.slice(6)}`;
              } else {
                  cErr('Phone number is not in the expected format.');
                  myTele = '';
              }
          }
      }
  
      return {
          myFirstName,
          myLastName,
          myInitials,
          myEmail,
          myTele
      };
  }
  
function myStatsWidget() {
  if (!ENABLE_MYSTATS_WIDGET) return;

  async function fetchRevexCalls({ startMs, endMs, comparisonStartMs, comparisonEndMs, timezone = "America/Halifax" }) {
    const parts = location.pathname.split("/");
    const locationIdIdx = parts.indexOf("location");
    if (locationIdIdx === -1 || !parts[locationIdIdx + 1]) throw new Error("Missing locationId in URL path.");
    const locationId = parts[locationIdIdx + 1];

    const idb = await new Promise((res, rej) => {
      const r = indexedDB.open("firebaseLocalStorageDb");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error("IndexedDB open failed."));
    });

    const rows = await new Promise((res, rej) => {
      const tx = idb.transaction("firebaseLocalStorage", "readonly");
      const os = tx.objectStore("firebaseLocalStorage");
      const rq = os.getAll();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => rej(rq.error || new Error("IndexedDB read failed."));
    });

    const row = rows.find(r => /authUser/.test(r.fbase_key));
    if (!row || !row.value) throw new Error("Auth user not found in IndexedDB.");
    const val = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
    const idToken = val?.stsTokenManager?.accessToken;
    if (!idToken) throw new Error("Missing Firebase ID token.");

    const url = `https://backend.leadconnectorhq.com/reporting/dashboards/revex/calls?locationId=${encodeURIComponent(locationId)}`;

    const body = {
      chartType: "donut",
      options: {
        aggregations: [{ operator: "count", field: "_id", i18nKey: "common.widget.metricCountOfCall", numberFormatType: "none", metricKey: "count::_id" }],
        groupBy: { fields: [{ field: "callStatus", type: "field" }], limit: 10, orderBy: "desc" },
        filters: [{ group: "AND", filters: [{ field: "dateAdded", operator: "time_series", value: [startMs, endMs] }, { group: "OR", filters: [] }]}],
        comparisonDate: { field: "dateAdded", operator: "time_series", value: [comparisonStartMs, comparisonEndMs] },
        timezone
      }
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        channel: "APP",
        source: "WEB_USER",
        version: "2021-04-15",
        "x-reporting-api-version": "3",
        "token-id": idToken
      },
      body: JSON.stringify(body),
      credentials: "omit",
      mode: "cors"
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      throw new Error(`RevEx calls failed: ${res.status} ${errTxt}`);
    }
    return res.json();
  }

  function getMsRangeForTodayInZone(timezone) {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    const [{ value: y }, , { value: m }, , { value: d }] = fmt.formatToParts(now);
    const startLocal = new Date(`${y}-${m}-${d}T00:00:00`);
    const endLocal = new Date(`${y}-${m}-${d}T23:59:59.999`);
    return { startMs: startLocal.getTime(), endMs: endLocal.getTime() };
  }

  function getYYYYMMDDInZone(timezone) {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    return fmt.format(now);
  }

  (async () => {
    const timezone = "America/Halifax";
    const { startMs, endMs } = getMsRangeForTodayInZone(timezone);
    const oneDay = 24 * 60 * 60 * 1000;
    const comparisonStartMs = startMs - oneDay;
    const comparisonEndMs = endMs - oneDay;

    try {
      const data = await fetchRevexCalls({ startMs, endMs, comparisonStartMs, comparisonEndMs, timezone });
      const calls = data?.data?.[0]?.stats?.total ?? 0;

      const todayStr = getYYYYMMDDInZone(timezone);
      const stored = JSON.parse(localStorage.getItem("totalCallsToday") || "{}");
      stored[todayStr] = { calls };
      localStorage.setItem("totalCallsToday", JSON.stringify(stored));

      // console.log("RevEx call data:", calls);
    } catch (err) {
      console.error("Error fetching RevEx calls:", err);
    }
  })();
}


  async function hideCallSummaryNotes() {
      const container = document.getElementById("notes-list-container-contact");
      if (!container) return;
  
      const userInfo = await getUserData();
  
      if (!userInfo) return;
  
      let myFullName = '';
      let myFirstName = '';
      let myLastName = '';
      let myInitials = '';
      let myEmail = '';
      let myTele = '';
  
      if (userInfo && userInfo.myFirstName) {
          myFullName = userInfo.myFirstName + ' ' + userInfo.myLastName;
          myFirstName = userInfo.myFirstName;
          myLastName = userInfo.myLastName;
          myInitials = userInfo.myInitials;
          myEmail = userInfo.myEmail;
          myTele = userInfo.myTele;
      }
  
      const noteBlocks = container.querySelectorAll('div.note-content');
      if (!noteBlocks) return;
  
      for (const noteBlock of noteBlocks) {
          const content = noteBlock.innerText.toLowerCase();
          const isCallSummary = content.includes("****call summary");
  
          if (isCallSummary) {
              const target = noteBlock.parentNode.parentNode.parentNode;
              if (target && target.style.display !== "none") {
                  target.style.display = "none";
              }
          }
      }
  }
  
  
  function findAllNoteBlocks({
    maxMs = 10000,     // absolute cap
    quietMs = 1500,    // stop if no new nodes for this long
    pollIntervalMs = 250
  } = {}) {
    const start = Date.now();
    let stopped = false;
    let resolve;
    let pollTimer = null;
    let timeoutTimer = null;
    let observer = null;
    let lastMutationAt = Date.now(); // updated whenever new nodes arrive
  
    const container = document.getElementById("notes-list-container-contact");
    if (!container) return Promise.resolve(null);
  
    function matchBlockIn(root) {
      const noteBlocks = root.querySelectorAll(
        'div.note-content'
      );
  
      for (const noteBlock of noteBlocks) {
        const content = noteBlock.innerText.toLowerCase();
  
        const isCallSummary = content.includes("****call summary");
        const hasAddressAndName =
          content.includes("address") && content.includes("name") && content.includes("email");
        const hasFirstAndLastName =
          content.includes("first name") && content.includes("last name");
        const hasSourceAndName =
          content.includes("source") && content.includes("name");
        const hasFirstNameSnakeCase = content.includes("first_name");
  
        const matches =
          (hasAddressAndName || hasFirstAndLastName || hasSourceAndName || hasFirstNameSnakeCase) &&
          !isCallSummary;
  
        if (matches) return noteBlock;
      }
      return null;
    }
  
    function stop(result) {
      if (stopped) return;
      stopped = true;
  
      if (observer) observer.disconnect();
      if (pollTimer) clearTimeout(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
  
      // No scroll adjustments here — ever.
      resolve(result || null);
    }
  
    function tick() {
      if (stopped) return;
  
      // Check current DOM for a match
      const match = matchBlockIn(container);
      if (match) return stop(match);
  
      // Stop if we've seen no new nodes for quietMs
      const noNewNodesRecently = Date.now() - lastMutationAt >= quietMs;
      if (noNewNodesRecently) return stop(null);
  
      // Keep polling
      pollTimer = setTimeout(tick, pollIntervalMs);
    }
  
    // Observe for any additions anywhere inside the container
    observer = new MutationObserver((mutations) => {
      if (stopped) return;
  
      // If any mutation adds nodes, refresh the "last mutation" timestamp
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length > 0) {
          lastMutationAt = Date.now();
          // Quick check immediately when new stuff appears
          const match = matchBlockIn(container);
          if (match) return stop(match);
        }
      }
    });
    observer.observe(container, { childList: true, subtree: true });
  
    // Hard timeout guard
    timeoutTimer = setTimeout(() => stop(null), maxMs);
  
    // Initial scan + start polling
    const promise = new Promise((res) => (resolve = res));
    tick();
  
    return promise;
  }
  
  
  function cleanMessageText(msg) {
      // Normalize spacing
      msg = msg
          .replace(/\u00A0/g, ' ')  // convert non-breaking space to regular space
          .replace(/\s+/g, ' ')     // collapse all whitespace
          .trim();
  
      const greetings = ['Hi', 'Hello', 'Hey'];
      const titles = ['Mr', 'Mrs', 'Dr', 'Miss'];
  
      greetings.forEach(greet => {
          // Match any amount of space(s) between greeting and comma
          msg = msg.replace(new RegExp(`\\b${greet}\\s*,`, 'gi'), `${greet},`);
  
          titles.forEach(title => {
              // Match any space(s) between greeting and title
              msg = msg.replace(new RegExp(`\\b${greet}\\s+${title}\\s*,`, 'gi'), `${greet},`);
          });
      });
  
      // Remove leftover titles like "Mr.," → ","
      titles.forEach(title => {
          msg = msg.replace(new RegExp(`\\b${title}\\.?,`, 'gi'), ',');
      });
  
      return msg
          .replaceAll(' at .', '.')
          .replaceAll(' at ?', '?')
          .replaceAll(/\bnot sure\b/gi, '')
          .replaceAll(/\bunknown\b/gi, '')
          .replaceAll(/\bsee comments\b/gi, '')
          .replaceAll(/\s+\./g, '.')
          .replaceAll(/\s+for \?/g, ' for your property?')
          .replace("Hi ,", "Hi,")
          .replaceAll(' at .', '.')
          .replaceAll(' at ?', '?')
          .replaceAll('Hi ,', 'Hi,')
          .replaceAll('Hi Mr,', 'Hi,')
          .replaceAll('Hi Mrs,', 'Hi,')
          .replaceAll('Hi Dr,', 'Hi,')
          .replaceAll('Hi Miss,', 'Hi,')
          .replaceAll('Hello Mr,', 'Hello,')
          .replaceAll('Hello Mrs,', 'Hello,')
          .replaceAll('Hello Dr,', 'Hello,')
          .replaceAll('Hello Miss,', 'Hello,')
          .replaceAll('Hey Mr,', 'Hey,')
          .replaceAll('Hey Mrs,', 'Hey,')
          .replaceAll('Hey Dr,', 'Hey,')
          .replaceAll('Hey Miss,', 'Hey,')
          .replaceAll('Hey ,', 'Hey,')
          .replaceAll('Mr.,', ',')
          .replaceAll('Mrs.,', ',')
          .replaceAll('Dr.,', ',')
          .replaceAll('Miss,', ',')
          .replaceAll('Hello ,', 'Hello,')
          .replaceAll(/\bnot sure\b/gi, '')
          .replaceAll(/\bunknown\b/gi, '')
          .replaceAll(/\bsee comments\b/gi, '')
          .replaceAll(/\s+\./g, '.')
          .replaceAll(/\s+for \?/g, ' for your property?')
          .trim();
  }
  
  function cleanMessageEmail(msg) {
      // Normalize spacing
      msg = msg;
  
      const greetings = ['Hi', 'Hello', 'Hey'];
      const titles = ['Mr', 'Mrs', 'Dr', 'Miss'];
  
      greetings.forEach(greet => {
          // Match any amount of space(s) between greeting and comma
          msg = msg.replace(new RegExp(`\\b${greet}\\s*,`, 'gi'), `${greet},`);
  
          titles.forEach(title => {
              // Match any space(s) between greeting and title
              msg = msg.replace(new RegExp(`\\b${greet}\\s+${title}\\s*,`, 'gi'), `${greet},`);
          });
      });
  
      // Remove leftover titles like "Mr.," → ","
      titles.forEach(title => {
          msg = msg.replace(new RegExp(`\\b${title}\\.?,`, 'gi'), ',');
      });
  
      return msg
          .replaceAll(' at .', '.')
          .replaceAll(' at ?', '?')
          .replaceAll(/\bnot sure\b/gi, '')
          .replaceAll(/\bunknown\b/gi, '')
          .replaceAll(/\bsee comments\b/gi, '')
          .replaceAll(/\s+\./g, '.')
          .replaceAll(/\s+for \?/g, ' for your property?')
          .replace("Hi ,", "Hi,")
          .replaceAll(' at .', '.')
          .replaceAll(' at ?', '?')
          .replaceAll('Hi ,', 'Hi,')
          .replaceAll('Hi Mr,', 'Hi,')
          .replaceAll('Hi Mrs,', 'Hi,')
          .replaceAll('Hi Dr,', 'Hi,')
          .replaceAll('Hi Miss,', 'Hi,')
          .replaceAll('Hello Mr,', 'Hello,')
          .replaceAll('Hello Mrs,', 'Hello,')
          .replaceAll('Hello Dr,', 'Hello,')
          .replaceAll('Hello Miss,', 'Hello,')
          .replaceAll('Hey Mr,', 'Hey,')
          .replaceAll('Hey Mrs,', 'Hey,')
          .replaceAll('Hey Dr,', 'Hey,')
          .replaceAll('Hey Miss,', 'Hey,')
          .replaceAll('Hey ,', 'Hey,')
          .replaceAll('Mr.,', ',')
          .replaceAll('Mrs.,', ',')
          .replaceAll('Dr.,', ',')
          .replaceAll('Miss,', ',')
          .replaceAll('Hello ,', 'Hello,')
          .replaceAll(/\bnot sure\b/gi, '')
          .replaceAll(/\bunknown\b/gi, '')
          .replaceAll(/\bsee comments\b/gi, '')
          .replaceAll(/\s+\./g, '.')
          .replaceAll(/\s+for \?/g, ' for your property?')
          .trim();
  }
  
  
  async function extractNoteData() {
    try {
      const container = document.getElementById("notes-list-container-contact");
      if (!container) return;
  
      // Find notes block
      if (!notesScrollInitialized) {
        noteBlock = await findAllNoteBlocks({ maxMs: 12000, pollIntervalMs: 250, maxStableChecks: 3 });
      }
  
      let json = {};
      let keyMapping = {};
  
      const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
      const extractValidEmail = (s = "") => {
        const m = (s || "").match(EMAIL_REGEX);
        return m ? m[0].toLowerCase() : "";
      };
  
      function toUspsState(s = "") {
        s = (s || "").trim();
        if (!s) return "";
        if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
        const map = { Alabama:"AL", Alaska:"AK", Arizona:"AZ", Arkansas:"AR", California:"CA",
          Colorado:"CO", Connecticut:"CT", Delaware:"DE", "District of Columbia":"DC", Florida:"FL",
          Georgia:"GA", Hawaii:"HI", Idaho:"ID", Illinois:"IL", Indiana:"IN", Iowa:"IA", Kansas:"KS",
          Kentucky:"KY", Louisiana:"LA", Maine:"ME", Maryland:"MD", Massachusetts:"MA", Michigan:"MI",
          Minnesota:"MN", Mississippi:"MS", Missouri:"MO", Montana:"MT", Nebraska:"NE", Nevada:"NV",
          "New Hampshire":"NH", "New Jersey":"NJ", "New Mexico":"NM", "New York":"NY",
          "North Carolina":"NC", "North Dakota":"ND", Ohio:"OH", Oklahoma:"OK", Oregon:"OR",
          Pennsylvania:"PA", "Rhode Island":"RI", "South Carolina":"SC", "South Dakota":"SD",
          Tennessee:"TN", Texas:"TX", Utah:"UT", Vermont:"VT", Virginia:"VA", Washington:"WA",
          "West Virginia":"WV", Wisconsin:"WI", Wyoming:"WY" };
        const key = s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        return map[key] || "";
      }
  
      // ---- Pair extraction that handles jammed lines and keeps hyphens inside values ----
      // We only treat " - " (space-hyphen-space), ":" or 2+ spaces as delimiters.
      // This avoids splitting values like "2-3 months".
      function explodeAllPairs(text) {
        const lines = (text || "")
          .replace(/\s{2,}/g, "  ")
          .replace("، الولايات المتحدة", "")
          .split("\n")
          .map(s => s.trim())
          .filter(Boolean);
  
        const out = [];
        const KEY_RE = /^[A-Za-z][A-Za-z\s]*$/;
  
        for (let line of lines) {
          // Iteratively peel off leading key/value pairs from the line
          let s = line;
          while (s.length) {
            // Find the first delimiter occurrence: " - ", ":", or 2+ spaces
            const m = s.match(/\s-\s|:|\s{2,}/);
            if (!m) { break; }
  
            const delimIdx = m.index;
            const delim = m[0];
  
            const keyCand = s.slice(0, delimIdx).trim();
            if (!KEY_RE.test(keyCand)) {
              // Not a valid key → stop processing this line
              break;
            }
  
            // Find the next key start to bound the value
            // Look for " <letters> (then delimiter)" ahead
            const rest = s.slice(delimIdx + delim.length);
            const next = rest.search(/\s{1,}[A-Za-z][A-Za-z\s?()']*\s(?:-\s|:|\s{2,})/);
  
            let value, remainder;
            if (next === -1) {
              value = rest.trim();
              remainder = "";
            } else {
              value = rest.slice(0, next).trim();
              remainder = rest.slice(next).trim();
            }
  
            // Preserve spaces when normalizing the key
            out.push([keyCand.toLowerCase().replace(/[^a-z0-9\s]/gi, "").replace(/\s+/g, ""), value]);
  
            // Continue with the remainder to catch further pairs
            s = remainder;
          }
        }
        return out;
      }
  
      if (noteBlock) {
        keyMapping = {
          sellerFullName: ["name", "callername"],
          sellerFirstName: ["firstname", "firstn ame", "firstname(s)"],
          sellerLastName: ["lastname", "lastname(s)"],
          sellerPhone: ["phone", "mayihaveyourphonenumber"],
          sellerEmail: ["email", "mayihaveyouremailaddress"],
          propertyAddressLine1: ["streetaddress"],
          propertyAddress: [
            "addressstreetaddress", "formattedaddress",
            "mayihavethephysicaladdressorapntotheproperty?(oranyotherpropertyidentifier)",
            "street", "address", "propertyaddress"
          ],
          propertyStreetNumber: ["streetnumber"],
          propertyGarage: ["garage"],
          propertyBedrooms: ["bedrooms"],
          propertyBathrooms: ["bathrooms"],
          propertyRepairs: ["repairs"],
          propertyOccupied: ["occupied"],
          sellerUrgency: ["sellfast"],
          propertyGoal: ["goal"],
          propertyOwner: ["owner"],
          propertyOwnedYears: ["ownedyears"],
          propertyMortgage: ["mortgage"],
          propertyListed: ["listed", "isthepropertylistedwitharealtornoworhasitbeeninthelast12months"],
          listedPrice: ["ifyeshowmuchiswasitlistedfor"],
          propertyCountyName: ["countyname", "county", "whatcountyisthepropertylocatedin"],
          propertyCity: ["citystate", "city"],
          propertyState: ["state"],
          propertyZip: ["zip", "postalcode"],
          leadDate: ["date"],
          leadStatus: ["leadstatus"],
          leadSource: ["source"],
          leadSourceChannel: ["sourcechannel"],
          appointmentDate: ["appointmentdate", "appointment"],
          scenario: ["scenario"],
          callId: ["callid"],
          callFromNumber: ["fromnumber"],
          callToNumber: ["tonumber"],
          callStart: ["callstart"],
          callStop: ["callstop"],
          callDuration: ["duration"],
          callStatus: ["callstatus"],
          askingPrice: ["howmuchareyouaskingforyourproperty"],
          isOwner: ["areyoutheownerofrecord"],
          ownerOfRecord: ["ifnowhoistheownerofrecord"],
          ownerRelationship: ["ifnorelationship"],
          isFreeAndClear: ["doownthepropertyfreeandclear"],
          amountOwed: ["ifnohowmuchowed"],
          additionalPropertyNotes: ["doyouhaveanythingelseyouliketoshareaboutyourproperty"],
          saleReason: ["thankyouforprovidingthisinformationonelastquestionwhyareyoulookingtosellyourproperty"],
          additionalComments: [
            "comments",
            "mayiaskthenatureofyourcall"
          ]
        };
  
        json = Object.fromEntries(Object.keys(keyMapping).map(k => [k, ""]));
  
        const noteText = (noteBlock.innerText || "").trim();
        const pairs = explodeAllPairs(noteText);
  
        // Map pairs → json (skip empties; avoid poisoning)
        for (const [rawKey, value] of pairs) {
          if (!value) continue;
          let mappedKey = null;
          for (const [key, aliases] of Object.entries(keyMapping)) {
            if (aliases.includes(rawKey)) { mappedKey = key; break; }
          }
          if (!mappedKey) continue;
  
          const sanitized = mappedKey === "sellerEmail" ? extractValidEmail(value) : value;
          if (mappedKey !== "sellerEmail" || sanitized) {
            if (!json[mappedKey]) json[mappedKey] = sanitized;
          }
        }
  
        // Fallback email scan
        if (!json.sellerEmail) {
          const found = extractValidEmail(noteText);
          if (found) json.sellerEmail = found;
        }
        
        if (json.sellerFullName) {
          // Keep everything until another valid key appears
          json.sellerFullName = json.sellerFullName
            .replace(/\s{2,}(?=[A-Za-z][A-Za-z\s?()']*\s(?:-\s|:|\s{2,}))/g, "")
            .trim();
        }
        
        // Backfill first and last names from full name if available
        if (!json.sellerFirstName && json.sellerFullName) {
          const parts = json.sellerFullName.trim().split(/\s+/);
          if (parts.length) {
            json.sellerFirstName = json.sellerFirstName || parts[0];
            if (!json.sellerLastName && parts.length > 1) {
              json.sellerLastName = parts.slice(1).join(" ");
            }
          }
        }
        
        // Treat lone hyphen values like "Comments:  -" as empty
        ["additionalComments", "appointmentDate", "scenario"].forEach(k => {
          if (json[k] && json[k].trim() === "-") json[k] = "";
        });
      }
  
      // Form input fallbacks if present
      const formLine1 = document.querySelector('[name="contact.street_address"]')?.value?.replace(", USA", "").replace(" USA", "");
      const formCity  = document.querySelector('[name="contact.property_city"]')?.value;
      const formST    = document.querySelector('[name="contact.state_property"]')?.value;
      const formZip   = document.querySelector('[name="contact.property_postal_code"]')?.value;
  
      // --- Address parsing from captured "address" field ---
      const capturedFull = (json.propertyAddress || "").trim();
  
      function parseAddress(full) {
        if (!full) return {};
        const cnt = (full.match(/,/g) || []).length;
        if (cnt >= 2) {
          // "Street, City, ST ZIP"
          const parts = full.split(",").map(s => s.trim());
          const line1 = parts[0] || "";
          const city  = parts[1] || "";
          const sz    = (parts[2] || "").split(/\s+/);
          const st    = toUspsState(sz[0] || "");
          const zip   = (sz[1] || "").trim();
          return { line1, city, st, zip };
        } else if (cnt === 1) {
          // "Street, City ST ZIP"
          const parts = full.split(",").map(s => s.trim());
          const line1 = parts[0] || "";
          const csz   = (parts[1] || "").split(/\s+/);
          const city  = csz[0] || "";
          const st    = toUspsState(csz[1] || "");
          const zip   = (csz[2] || "").trim();
          return { line1, city, st, zip };
        } else {
          // Try "Street City ST ZIP"
          const m = full.match(/^(.*)\s+([A-Za-z\s]+?)\s+([A-Za-z]{2})\s+(\d{5})$/);
          if (m) {
            return { line1: (m[1] || "").trim(), city: (m[2] || "").trim(), st: toUspsState(m[3] || ""), zip: (m[4] || "").trim() };
          }
          return {};
        }
      }
  
      // Prefer captured address; if bad, fall back to form fields
      let parsed = parseAddress(capturedFull);
      // If line1 parsed as a 2-letter state (bad), try to rebuild from form fields
      if (!parsed.line1 || /^[A-Za-z]{2}$/.test(parsed.line1)) {
        // Try reconstruct from form
        if (formLine1 && (formCity || parsed.city) && (formST || parsed.st)) {
          parsed = {
            line1: formLine1,
            city : (formCity || parsed.city || "").trim(),
            st   : toUspsState(formST || parsed.st || ""),
            zip  : (formZip || parsed.zip || "").trim()
          };
        } else if (capturedFull) {
          // As a last resort, take the first comma segment as line1 only if it contains a digit (street number)
          const firstSeg = capturedFull.split(",")[0]?.trim() || "";
          if (/\d/.test(firstSeg)) {
            parsed.line1 = firstSeg;
          }
        }
      }
  
      // Apply parsed/form values to json
      if (parsed.line1) json.propertyAddressLine1 = parsed.line1;
      if (parsed.city || formCity) json.propertyCity = (json.propertyCity || parsed.city || formCity || "").trim();
      const finalST = toUspsState(json.propertyStateShort || parsed.st || json.propertyState || formST || "");
      if (finalST) json.propertyStateShort = finalST;
      if (!json.propertyZip) json.propertyZip = (parsed.zip || formZip || "").trim();
  
      // Final address rebuild: "Street, City, ST ZIP"
      {
        const line1 = (json.propertyAddressLine1 || formLine1 || "").trim();
        const city  = (json.propertyCity || formCity || "").trim();
        const st    = toUspsState(json.propertyStateShort || json.propertyState || formST || "");
        const zip   = (json.propertyZip || formZip || "").trim();
        const stZip = [st, zip].filter(Boolean).join(" ");
        if (line1 && city) {
          json.propertyAddress = [line1, city, stZip].filter(Boolean).join(", ");
        } else {
          // fallback to any captured full if it looks valid
          if (capturedFull) json.propertyAddress = capturedFull;
        }
      }
  
      // Normalize common fields
      if (json.sellerEmail) json.sellerEmail = json.sellerEmail.toLowerCase().trim();
  
      if (json.sellerPhone) {
        let digits = json.sellerPhone.replace(/\D/g, "");
        if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
        json.sellerPhone = digits;
        json.sellerPhoneFormatted = digits.length === 10
          ? `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
          : digits;
      }
  
      // Inputs casing
      const properCaseJSON = ["propertyStreetName", "propertyCity", "propertyCountyName"];
      const properCaseInput = ["contact.first_name", "contact.last_name", "contact.full_name_new", "contact.property_city"];
      const upperCaseInput = ["contact.state_property"];
  
      properCaseInput.forEach(name => {
        const el = document.querySelector(`[name="${name}"]`);
        if (el && el.value && el.value !== toProperCase(el.value) && !el.value.includes("'")) {
          setInputValue(el, toProperCase(el.value), "propercase input");
        }
      });
      upperCaseInput.forEach(name => {
        const el = document.querySelector(`[name="${name}"]`);
        if (el && el.value !== el.value.toUpperCase()) {
          setInputValue(el, el.value.toUpperCase(), "uppercase input");
        }
      });
      properCaseJSON.forEach(k => { if (json[k]) json[k] = toProperCase(json[k]); });
  
      // Clean noise keys we never want to persist
      ["postal code","street address","street name","street number","formatted address","address","street","phone","name","phone raw",
       "callStart","callStop","callDuration","callStatus","callId","leadSourceChannel","leadStatus","leadSource"
      ].forEach(k => delete json[k]);
  
      // Extra safety: if a jammed line made scenario contain another pair text, blank it
      if (/^[a-z\s]+-\s*/i.test(json.scenario || "")) json.scenario = "";
  
      // County name normalization
      if (!json.propertyCountyName && json.propertyCounty) json.propertyCountyName = json.propertyCounty;
  
      // StreetName fallback
      if (!json.propertyStreetName) json.propertyStreetName = json.propertyAddressLine1 || "";
  
      // Final sanity: if line1 wrongly became a 2-letter state, clear it
      if (json.propertyAddressLine1 && /^[A-Za-z]{2}$/.test(json.propertyAddressLine1)) {
        json.propertyAddressLine1 = (formLine1 || parsed.line1 || "").trim();
        // rebuild address again if we fixed line1
        const city  = (json.propertyCity || formCity || "").trim();
        const st    = toUspsState(json.propertyStateShort || json.propertyState || formST || "");
        const zip   = (json.propertyZip || formZip || "").trim();
        const stZip = [st, zip].filter(Boolean).join(" ");
        if (json.propertyAddressLine1 && city) {
          json.propertyAddress = [json.propertyAddressLine1, city, stZip].filter(Boolean).join(", ");
        }
      }
  
      // console.log(JSON.stringify(json, null, 2));
      return json;
    } catch (error) {
      console.error("[extractNoteData] Unhandled error:", error);
      console.debug("[extractNoteData] Stack trace:", error.stack);
      console.debug("[extractNoteData] Error type:", error.name);
      console.debug("[extractNoteData] Error message:", error.message);
      return null;
    }
  }
  
  function applyFallbacks(json) {
      return;
      const fallbackMappings = {
          sellerEmail: '[name="contact.email"]',
          sellerPhone: '[name="contact.phone"]',
          sellerFirstName: '[name="contact.first_name"]',
          sellerLastName: '[name="contact.last_name"]',
          sellerAddressLine1: '[name="contact.street_address"]',
          propertyAddressLine1: '[name="contact.street_address"]',
          propertyCity: '[name="contact.property_city"]',
          propertyStateShort: '[name="contact.state_property"]',
          propertyZip: '[name="contact.property_postal_code"]'
      };
  
      for (const [key, selector] of Object.entries(fallbackMappings)) {
          if (!json[key] || key === "sellerFirstName" || key === "sellerLastName" && key !== "propertyStateShort") {
              const input = document.querySelector(selector);
              const value = input?.value?.trim();
              if (value) json[key] = value;
          }
      }
  
      // for (const [key, selector] of Object.entries(fallbackMappings)) {
      //     if (!json[key] || key !== "sellerFirstName" || key !== "sellerLastName" && key === "propertyStateShort") {
      //         const input = document.querySelector(selector);
      //         const value = input?.value?.trim();
      //         if (value) json[key] = value;
      //     }
      // }
  }
  
  function setInputValue(input, value, src) {
      if (!input) return;
  
      console.groupCollapsed(`Setting input: ${input.name || input.id || '(unnamed)'}`);
      console.log('Element:', input);
      console.log('Value:', value);
      console.log('Source:', src);
      console.groupEnd();
  
      // Only proceed if the value is different
      if (input.value !== value) {
          // Use the native setter from the prototype chain
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              Object.getPrototypeOf(input),
              'value'
          )?.set;
  
          if (nativeInputValueSetter) {
              nativeInputValueSetter.call(input, value);
          } else {
              input.value = value; // fallback
          }
  
          // Dispatch both events to notify React and any vanilla listeners
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
      }
  }
  
  
  
  
  async function populateFieldsWithExtractedData() {
      if (!ENABLE_UPDATE_INPUTS) return;
  
      const container = document.querySelector('.hl_contact-details-left');
      if (!container) return;
  
      const data = await extractNoteData();
      if (!data || Object.keys(data).length === 0) return;
  
      // Directional abbreviations
      const directionals = {
          "north": "N", "south": "S", "east": "E", "west": "W",
          "northeast": "NE", "northwest": "NW", "southeast": "SE", "southwest": "SW"
      };
  
      // Suffix abbreviations
      const suffixes = {
          "street": "St", "avenue": "Ave", "boulevard": "Blvd", "lane": "Ln",
          "drive": "Dr", "road": "Rd", "court": "Ct", "circle": "Cir", "place": "Pl",
          "terrace": "Ter", "way": "Way", "trail": "Trl", "parkway": "Pkwy"
      };
  
      // Handle name corrections for last and first names (e.g., O'Connor)
      const lastNmeMappings = {
          'oneal': "O'Neal", 'oneil': "O'Neil", 'oconnor': "O'Connor", 'oconner': "O'Conner", 'oconnel': "O'Connel", 'oconnell': "O'Connell",
          'odonnell': "O'Donnell", 'oneill': "O'Neill", 'omalley': "O'Malley", 'obrien': "O'Brien",
          'okelly': "O'Kelly", 'omeara': "O'Meara", 'oreilly': "O'Reilly", 'ocarroll': "O'Carroll",
          'ofarrell': "O'Farrell", 'ohara': "O'Hara", 'omurchu': "O'Murchu", 'oflaherty': "O'Flaherty",
          'okeefe': "O'Keefe", 'oquinn': "O'Quinn", 'ocallaghan': "O'Callaghan", 'ogrady': "O'Grady",
          'orourke': "O'Rourke", 'oconnors': "O'Connors", 'oflanagan': "O'Flanagan", 'odonoghue': "O'Donoghue",
          'ohanon': "O'Hanon", 'oreilly': "O'Reilly", 'oshea': "O'Shea", 'odonnell': "O'Donnell",
          'dangelo': "D'Angelo", 'damico': "D'Amico", 'dellacroce': "D'Ellacroce", 'dagostino': "D'Agostino",
          'dalessandro': "D'Alessandro", 'damato': "D'Amato", 'deangelis': "De'Angelis", 'deleo': "De'Leo",
          'delgrosso': "Del'Grosso", 'degrandis': "De'Grandis", 'deluc': "De'Lucia", 'devito': "De'Vito",
          'leheureux': "L'Heureux", 'louverture': "Louverture", 'lemoine': "Lemoine", 'leduc': "Leduc",
          'lalonde': "Lalonde", 'lablanc': "Lablanc", 'lambert': "Lambert", 'lafayette': "Lafayette",
          'macdonald': "MacDonald", 'mcdaniel': "McDaniel", 'macfarlane': "MacFarlane", 'mcgrath': "McGrath", 'mcnally': "McNally",
          'mcguire': "McGuire", 'mcneil': "McNeil", 'mcpherson': "McPherson", 'maclachlan': "MacLachlan",
          'macmillan': "MacMillan", 'macintosh': "MacIntosh", 'mcmillan': "McMillan", 'mcdonald': "McDonald",
          'mcdonnell': 'McDonnell', 'macdonnell': 'MacDonnell', 'leclerc': "Leclerc", 'lejeune': "Lejeune",
          'lemoine': "Lemoine", 'leduc': "Leduc", 'lalonde': "Lalonde", 'lacour': "Lacour", 'dumont': "Dumont",
          'dupont': "Dupont", 'danton': "Danton", 'desantis': "DeSantis", 'degiorgio': "DeGiorgio"
      };
  
      const contactFieldMapping = {
          "contact.first_name": "sellerFirstName",
          "contact.last_name": "sellerLastName",
          "contact.full_name_new": "sellerFullName",
          "contact.email": "sellerEmail",
          "contact.phone": "sellerPhone",
          "contact.street_address": "propertyAddressLine1",
          "contact.property_city": "propertyCity",
          "contact.county": "propertyCountyName",
          "contact.state_property": "propertyState",
          "contact.property_postal_code": "propertyZip",
          "contact.address1": "propertyAddressLine1",
          "contact.city": "propertyCity",
          "contact.county_new": "propertyCountyName",
          "contact.state": "propertyState",
          "contact.state_property": "propertyState",
          "contact.postal_code": "propertyZip",
          "contact.source": "source"
      };
  
      const junkValues = ["unknown", "not sure", "see comments", "()", "not given", "unkown", "uknown", "nan"];
  
      // Check if value is a junk value
      const isJunkValue = (value) => {
          return junkValues.some(junk => value.toLowerCase() === junk.toLowerCase());
      };
  
      for (const [fieldName, dataKey] of Object.entries(contactFieldMapping)) {
          const input = document.querySelector(`[name="${fieldName}"]`);
          let value = data[dataKey];
  
          // Fallback: if first or last name is missing, try to split full name
          if ((!value || value.trim() === "") && (fieldName === "contact.first_name" || fieldName === "contact.last_name")) {
              const fullNameInput = document.querySelector(`[name="contact.full_name_new"]`);
              if (fullNameInput && fullNameInput.value.trim()) {
                  const nameParts = fullNameInput.value.trim().split(" ");
                  if (fieldName === "contact.first_name") {
                      value = nameParts[0];
                  } else if (fieldName === "contact.last_name") {
                      value = nameParts.slice(1).join(" ");
                  }
              }
          }
  
          // Skip again if fallback resulted in a junk value
          if (!value || isJunkValue(value)) continue;
  
  
          if (dataKey === "sellerLastName" && typeof value === "string") {
              if (input) {
                  let inputValue = input.value.trim();
                  const normalizedInput = inputValue.toLowerCase();
                  const normalizedValue = value.toLowerCase();
  
                  const correctedFromInput = lastNmeMappings[normalizedInput];
                  const correctedFromValue = lastNmeMappings[normalizedValue];
  
                  // If the field is empty
                  if (inputValue === "") {
                      if (correctedFromValue) {
                          setInputValue(input, correctedFromValue, 'contactFieldMapping1');
                      } else {
                          setInputValue(input, toProperCase(value), 'contactFieldMapping2');
                      }
                  }
  
                  // If the user entered a known variant or lowercase version
                  else if (correctedFromInput && inputValue !== correctedFromInput) {
                      setInputValue(input, correctedFromInput, 'contactFieldMapping3');
                  }
  
                  // If the user typed the correct name but in wrong casing
                  else if (toProperCase(inputValue) !== toProperCase(value) && inputValue === value) {
                      setInputValue(input, toProperCase(value), 'contactFieldMapping4');
                  }
              }
              continue;
          }
  
          if (dataKey === "propertyState" && typeof value === "string") {
              value = value.toUpperCase();
  
              // Convert full state name to abbreviation if needed
              if (value.length !== 2) {
                  value = stateAbbreviations[toProperCase(value)] || value;
              }
  
              if (input) {
                  let inputValue = input.value.trim();
  
                  // If user entered a full state name or lowercase, convert it to proper abbreviation
                  if (inputValue.length !== 2) {
                      const abbrev = stateAbbreviations[toProperCase(inputValue)];
                      if (abbrev) {
                          inputValue = abbrev;
                          setInputValue(input, inputValue, 'contactFieldMapping5');
                          continue;
                      }
                  } else {
                      // Already an abbreviation, but may need to be uppercased
                      if (inputValue !== inputValue.toUpperCase()) {
                          inputValue = inputValue.toUpperCase();
                          setInputValue(input, inputValue, 'contactFieldMapping6');
                          continue;
                      }
                  }
  
                  // If input is blank, fill it in from data
                  if (inputValue === "") {
                      setInputValue(input, value, 'contactFieldMapping7');
                  }
              }
              continue;
          }
  
          // Apply directional and suffix abbreviation replacement to propertyAddressLine1
          if (dataKey === "propertyAddressLine1" && typeof value === "string") {
              const directionalPattern = new RegExp(`\\b(${Object.keys(directionals).join("|")})\\b`, "gi");
              const suffixPattern = new RegExp(`\\b(${Object.keys(suffixes).join("|")})\\b`, "gi");
  
              value = toProperCase(value);
  
              value = value.replace(directionalPattern, (match) => directionals[match.toLowerCase()] || match);
              value = value.replace(suffixPattern, (match) => suffixes[match.toLowerCase()] || match);
  
              if ((input && input.value.trim() === "" && value && value.trim() !== "")) {
                  setInputValue(input, value, 'contactFieldMapping8');
              }
  
              if ((input && input.value.trim().includes(",") && value && value.trim() !== "")) {
                  setInputValue(input, value, 'contactFieldMapping8');
              }
              continue;
          }
  
          if (input && input.value.trim() === "" && value && value.trim() !== "") {
              setInputValue(input, value, 'contactFieldMapping9');
          }
      }
  }
  
  function createFloatingModal({ id = 'note-floating-modal', styles = {}, onUpdatePosition = null }) {
      const modal = document.createElement('div');
      modal.id = id;
      modal.style.position = 'absolute';
      modal.style.backgroundColor = '#fff';
      modal.style.color = 'inherit';
      modal.style.padding = '20px';
      modal.style.borderRadius = '8px';
      modal.style.fontSize = 'inherit';
      modal.style.fontFamily = 'inherit';
      modal.style.zIndex = '10000';
      modal.style.maxWidth = '500px';
      modal.style.minWidth = '300px';
      modal.style.maxHeight = '80vh';
      modal.style.overflowY = 'auto';
      modal.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.3)';
      modal.style.display = 'none';
      modal.style.pointerEvents = 'auto';
      modal.style.whiteSpace = 'normal';
  
      Object.assign(modal.style, styles);
      document.body.appendChild(modal);
  
      document.addEventListener('mousemove', function (e) {
          if (modal.style.display === 'block') {
              modal.style.left = `${e.pageX + 15}px`;
              modal.style.top = `${e.pageY + 15}px`;
              if (onUpdatePosition) onUpdatePosition(e, modal);
          }
      });
  
      // Helper method to bind hover logic to elements
      modal.attachHover = (targetElement, htmlContent) => {
          targetElement.addEventListener('mouseenter', () => {
              modal.innerHTML = htmlContent;
              modal.style.display = 'block';
          });
  
          targetElement.addEventListener('mouseleave', () => {
              modal.style.display = 'none';
          });
      };
  
      return modal;
  }
  
  
  
  function conversationsBanner() {
      if (!ENABLE_BANNER_UPDATE) return;
  
      if (!isOnConversationsPage(location.href)) return;
  
      // if (!document.getElementById("notes-tab")) return;
      // if (!document.querySelector('[name="contact.first_name"]')) return; // ensure data is loaded
      if (bannerDismissed) return;
  
      // check for facebook integration banner, close
      const el = document.querySelector('#notification_banner-content-crm-integration-facebook-expired');
      if (el) {
          const btn = document.querySelector('#notification_banner-btn-close');
          if (btn) {
              btn.click();
          }
          // el.parentNode?.parentNode?.remove();
      }
  
      bannerTextLeft = ''; // Initialize to reset on each call
      bannerTextCenterRight = ''; // Initialize to reset on each call
      bannerTextCenterLeft = ''; // Initialize to reset on each call
      bannerTextRight = ''; // Initialize to reset on each call
  
      let sellerPhoneNumberRaw = '';
  
      let sellerName = document.querySelector('[name="msgsndr2"]')?.innerText;
  
      if (sellerName) {
          bannerTextLeft += sellerName;
      }
  
      const phoneDiv = Array.from(
          document.querySelectorAll(
              '.truncate-text.text-sm.font-normal.text-gray-600.hover\\:text-primary-700.cursor-pointer'
          )
      ).find(div => {
          const phoneRegex = /(\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{4})/;
          return phoneRegex.test(div.innerText.trim());
      });
  
      if (phoneDiv) {
          sellerPhoneNumberRaw = phoneDiv.innerText.replace(/\D/g, ''); // digits only
          const localTimeZone = getAreaCodeInfo(sellerPhoneNumberRaw);
          // console.log(localTimeZone);
          bannerTextCenterLeft += ` <br>Local Time: <b>${localTimeZone[2]} (${localTimeZone[1]})</b><br>Local Area: <b>${localTimeZone[0]}</b>`;
          // console.log(sellerPhoneNumberRaw);
          // console.log(getAreaCodeInfo(sellerPhoneNumberRaw));
      }
  
      // bannerTextCenterLeft += `<br>Local Time: <b>${getAreaCodeInfo(sellerPhoneNumberRaw)[2]} (${getAreaCodeInfo(sellerPhoneNumberRaw)[1]})</b><br>Local Area: <b>${getAreaCodeInfo(sellerPhoneNumberRaw)[0]}</b>`
  
      // Build banner if it doesn't exist
      const bannerDiv = document.createElement('div');
      bannerDiv.id = 'notification_banner-top_bar_conversations';
      bannerDiv.setAttribute('role', 'region');
      bannerDiv.setAttribute('aria-label', 'Notification Banner');
      bannerDiv.className = 'notification-banner-top-bar-conversations';
  
      // Add appropriate styles and structure
      bannerDiv.style = `
              background-color: rgb(208, 248, 171);
              position: fixed;
              width: 100%;
              z-index: 999;
              min-height: 48px;
              top: 0;
              padding: 4px 12px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 24px;
              box-sizing: border-box;
              padding-right: 21%;
          `;
  
  
      let innerHTMLStr = `
              <!-- LEFT SECTION -->
              <div id="notification-banner-left"
                   class="notification-banner-left text-sm text-gray-900"
                   style="flex: 0 0 40%; text-align: left; line-height: 1.5; overflow: hidden; padding: 0 38px; color: inherit;">
                  ${bannerTextLeft}
              </div>
  
              <!-- CENTER LEFT SECTION -->
              <div id="notification-banner-center-left"
                   class="notification-banner-center-left text-sm text-gray-900"
                   style="flex: 0 0 25%; text-align: left; white-space: nowrap; overflow: hidden; padding: 0 8px; color: inherit;">
                  ${bannerTextCenterLeft}
              </div>
  
              <!-- CENTER RIGHT SECTION -->
              <div id="notification-banner-center-right"
                   class="notification-banner-center-right text-sm text-gray-900"
                   style="flex: 0 0 20%; text-align: center; white-space: nowrap; overflow: hidden; padding: 0 8px; color: inherit;">
                  ${bannerTextCenterRight}
              </div>
  
              <!-- RIGHT SECTION -->
              <div id="notification-banner-right"
                   class="notification-banner-right text-sm text-gray-900"
                   style="flex: 0 0 15%; text-align: center; white-space: nowrap; overflow: hidden; padding: 0 8px; color: inherit;">
                  ${bannerTextRight}
              </div>
              <!-- Close Button -->
              <button id="notification_banner-btn-close" aria-label="Close notification"
                  class="w-7 h-7 flex items-center justify-center rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-white/80"
                  style="position: absolute; top: 28px; left: 1%; z-index: 10001; color: inherit;">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="var(--gray-700)"
                      aria-hidden="true" class="w-5 h-5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M18 6L6 18M6 6l12 12" />
                  </svg>
              </button>
          `;
  
  
      bannerDiv.innerHTML = innerHTMLStr;
      // Close button click event
      bannerDiv.querySelector('#notification_banner-btn-close')?.addEventListener('click', () => {
          bannerDiv.remove();
          bannerDismissed = true;
      });
  
      const banner = document.getElementById('notification_banner-top_bar_conversations');
      if (!banner) {
  
          // Insert the banner into the DOM
          const appContainer = document.querySelector('.container-fluid');
          if (appContainer?.parentNode) {
              appContainer.parentNode.insertBefore(bannerDiv, appContainer);
          }
      } else {
          banner.innerHTML = innerHTMLStr;
      }
  }
  
  async function modalBanner() {
    return;
    const isOnContactPage = await isOnContactPage(location.href);
    if (!isOnContactPage) return;
  
    const config = window.scriptConfig || {};
    const bannerMode = config.bannerMode;
    const debugON = config.debug;
  
    if (bannerMode === "modal") {
      const userInfo = await getUserData();
      if (!userInfo) return;
  
      let sellerFirstName = document.querySelector('[name="contact.first_name"]')?.value || "";
      let sellerEmail = document.querySelector('[name="contact.email"]')?.value || "";
      let propertyAddressLine1 = document.querySelector('[name="contact.street_address"]')?.value || "";
      let propertyStreetName = getStreetName(document.querySelector('[name="contact.street_address"]')?.value) || "";
  
      let myFullName = '';
      let myFirstName = '';
      let myLastName = '';
      let myInitials = '';
      let myEmail = '';
      let myTele = '';
  
      if (userInfo && userInfo.myFirstName) {
        myFullName = userInfo.myFirstName + ' ' + userInfo.myLastName;
        myFirstName = userInfo.myFirstName;
        myLastName = userInfo.myLastName;
        myInitials = userInfo.myInitials;
        myEmail = userInfo.myEmail;
        myTele = userInfo.myTele;
      }
  
      // ===== FULL FIX WITH "END CALL" BUTTON TOGGLE + PER-ROUTE SUPPRESSION =====
      (() => {
        if (document.getElementById('modalOverlay')) return;
  
        // ---------- namespace + helpers ----------
        window.__leadTools = window.__leadTools || {};
        const NS = window.__leadTools;
        if (typeof NS.delay !== 'function') NS.delay = ms => new Promise(res => setTimeout(res, ms));
  
        // ---------- per-route suppression (stay closed until SPA route changes) ----------
        const MODAL_SUPPRESS_PREFIX = 'modalSuppressed::';
        const PAGE_KEY = `${MODAL_SUPPRESS_PREFIX}${location.pathname}${location.search}${location.hash}`;
  
        // If user previously closed on this route, don't open again
        try {
          if (sessionStorage.getItem(PAGE_KEY) === '1') return;
        } catch (e) {}
  
        // One-time hook into SPA navigation so a new route re-allows the modal
        (() => {
          if (NS.historyHooked) return;
          NS.historyHooked = true;
  
          const cleanOldKeys = () => {
            try {
              for (let i = sessionStorage.length - 1; i >= 0; i--) {
                const k = sessionStorage.key(i);
                if (k && k.startsWith(MODAL_SUPPRESS_PREFIX)) sessionStorage.removeItem(k);
              }
            } catch (e) {}
          };
  
          const onRouteChange = () => {
            cleanOldKeys();
          };
  
          const _push = history.pushState;
          const _replace = history.replaceState;
  
          history.pushState = function () {
            const ret = _push.apply(this, arguments);
            onRouteChange();
            return ret;
          };
          history.replaceState = function () {
            const ret = _replace.apply(this, arguments);
            onRouteChange();
            return ret;
          };
          window.addEventListener('popstate', onRouteChange);
        })();
  
        // ---------- styles (idempotent, hard overrides) ----------
        if (!document.getElementById('leadtools-style')) {
          const style = document.createElement('style');
          style.id = 'leadtools-style';
          style.textContent = `
            #modalOverlay{
              position:fixed;inset:0;background:rgba(0,0,0,0.7);
              display:flex;align-items:center;justify-content:center;z-index:999999
            }
            #modal{
              background:#fff;border-radius:12px;
              width:90vw !important;height:90dvh !important;
              max-width:none !important;max-height:none !important;
              display:flex;flex-direction:column;
              box-shadow:0 4px 15px rgba(0,0,0,0.4);
              font-family:sans-serif;font-size:2rem;line-height:1.6;
            }
            @supports not (height: 90dvh){
              #modal{ height:90vh !important; }
            }
            #modal .body{padding:30px;flex:1;overflow-y:auto}
            #modal .voicemail{padding:30px;border-top:2px solid #ddd;font-size:1.8rem}
            #modal footer{
              padding:20px;border-top:2px solid #ddd;
              display:flex;flex-wrap:wrap;justify-content:center;gap:20px
            }
            #modal button{
              cursor:pointer;font-size:2rem;padding:18px 28px;
              border-radius:12px;border:none;min-width:220px
            }
            #modal button.primary{
              background:#007bff !important;color:#fff !important;
            }
            #modal button.call{
              background:#28a745 !important;color:#fff !important;
            }
            #modal button.end{
              background:#dc3545 !important;color:#fff !important;
            }
            #modal button.secondary{
              background:#ccc !important;
            }
          `;
          document.head.appendChild(style);
        }
  
        // ---------- actions ----------
        window.clickToCall = async function clickToCall() {
          const labelBlock = document.querySelector('.hl_header--controls');
          if (!labelBlock) return console.warn('No .hl_header--controls');
          const innerBlock = labelBlock.querySelector('.contact-detail-actions');
          if (!innerBlock) return console.warn('No .contact-detail-actions');
          const phoneIcon = innerBlock.querySelector('i.fa.fa-phone');
          if (!phoneIcon) return console.warn('No phone icon');
          const targetElement = phoneIcon.parentElement;
          await NS.delay(10);
          targetElement?.click();
          phoneIcon?.click();
        };
  
        window.clickToNextContact = async function clickToNextContact() {
          const labelBlock = document.querySelector('.d-inline-block.text-xs.text-gray-900');
          const innerBlock = labelBlock?.querySelector('.d-inline-block');
          const caret = innerBlock?.querySelector('i.fa.fa-caret-right.--blue');
          if (caret?.parentElement) { await NS.delay(5000); caret.parentElement.click(); return; }
          const fbCaret = document.querySelector('.hl_header--controls i.fa.fa-caret-right');
          const fbTarget = fbCaret ? fbCaret.closest('.pointer, span, button, a, div') : null;
          if (fbTarget) { await NS.delay(5000); fbTarget.click(); return; }
          console.warn('Next caret not found.');
        };
  
        window.clickToEndCall = async function clickToEndCall() {
          const interval = setInterval(() => {
            const btn = document.querySelector('.dialer-body #end-call-button');
            if (btn) {
              btn.click();
              clearInterval(interval);
            }
          }, 200);
        };
  
        // ---------- cleaners ----------
        const isOnlyPipesOrSpace = t => /^\s*(\|\s*)*$/.test(t || '');
        function cleanNode(node) {
          if (!node) return node;
          if (node.nodeType === Node.TEXT_NODE) {
            const t = node.textContent || '';
            node.textContent = isOnlyPipesOrSpace(t) ? '' : t.replace(/\|/g, ' ').replace(/\s{2,}/g, ' ');
            return node;
          }
          if (node.nodeType === Node.ELEMENT_NODE) {
            node.removeAttribute('style');
            node.removeAttribute('id');
            node.removeAttribute('class');
            if (node.tagName === 'A') { node.remove(); return null; }
            if (node.tagName === 'I' && (node.className || '').includes('fa-clipboard')) {
              node.remove(); return null;
            }
          }
          [...node.childNodes].forEach(cleanNode);
          return node;
        }
  
        // ---------- extract name + address ----------
        const rawName = document.querySelector('#notification-banner-left')?.innerText.split('\n')[0].trim() || '';
        const firstName = rawName.split(' ')[0] || '';
        const rawAddress = document.querySelector('#notification-banner-left b')?.innerText.trim() || '';
  
        // ---------- clone & clean banner pieces ----------
        const left = document.querySelector('#notification-banner-left')?.cloneNode(true);
        const centerLeft = document.querySelector('#notification-banner-center-left')?.cloneNode(true);
        const cleanedLeft = left ? cleanNode(left) : null;
        const cleanedCenter = centerLeft ? cleanNode(centerLeft) : null;
  
        // ---------- build modal ----------
        const overlay = document.createElement('div');
        overlay.id = 'modalOverlay';
        overlay.innerHTML = `
          <div id="modal" role="dialog" aria-modal="true" aria-label="Lead details">
            <div class="body" id="modalBody"></div>
            <div class="voicemail" id="voicemailBody"></div>
            <footer>
              <button class="call" id="callBtn"><i class="fa fa-phone"></i> Call</button>
              <button class="end" id="endBtn"><i class="fa fa-phone-slash"></i> End Call</button>
              <button class="primary" id="nextBtn"><i class="fa fa-caret-right"></i> Next Account</button>
              <button class="secondary" id="modalFooterClose">Close</button>
            </footer>
          </div>
        `;
        document.body.appendChild(overlay);
  
        const m = document.getElementById('modal');
        if (m) {
          m.style.width = '90vw';
          m.style.height = (CSS.supports('height','90dvh') ? '90dvh' : '90vh');
          m.style.maxWidth = 'none';
          m.style.maxHeight = 'none';
        }
  
        const modalBody = document.getElementById('modalBody');
        const voicemailBody = document.getElementById('voicemailBody');
        if (cleanedLeft) modalBody.appendChild(cleanedLeft);
        if (cleanedCenter) modalBody.appendChild(cleanedCenter);
  
        modalBody.querySelectorAll('*').forEach(el => {
          el.childNodes.forEach(n => {
            if (n.nodeType === Node.TEXT_NODE) {
              n.textContent = (n.textContent || '').replace(/\s{2,}/g, ' ');
            }
          });
        });
  
        voicemailBody.innerHTML = `
          Hi ${firstName || '[first name]'}, my name is ${myFirstName}. I'm looking to purchase your property (on ${rawAddress || '[address]'}).<br>
          Please give me a call. My number is ${myTele}. Thanks!
        `;
  
        // ---------- handlers ----------
        const callBtn = document.getElementById('callBtn');
        const endBtn = document.getElementById('endBtn');
  
        // hide "End Call" button by default
        endBtn.style.display = 'none';
  
        function closeModal() {
          try { sessionStorage.setItem(PAGE_KEY, '1'); } catch (e) {}
          document.getElementById('modalOverlay')?.remove();
          window.removeEventListener('keydown', onKey);
        }
        function onKey(e) { if (e.key === 'Escape') closeModal(); }
  
        document.getElementById('modalFooterClose').onclick = closeModal;
  
        callBtn.onclick = () => {
          window.clickToCall();
          callBtn.style.display = 'none';
          endBtn.style.display = 'inline-block';
        };
  
        endBtn.onclick = () => {
          window.clickToEndCall();
          endBtn.style.display = 'none';
          callBtn.style.display = 'inline-block';
        };
  
        document.getElementById('nextBtn').onclick = () => window.clickToNextContact();
  
        document.getElementById('modalOverlay').addEventListener('click', e => {
          if (e.target.id === 'modalOverlay') closeModal();
        });
  
        window.addEventListener('keydown', onKey);
        const modalEl = document.getElementById('modal');
        modalEl.tabIndex = -1;
        modalEl.focus();
      })();
    }
  }
  
  
  async function updateBanner() {
      if (!ENABLE_BANNER_UPDATE) return;
  
      if (document.querySelector("#notification_banner-top_bar")?.innerText.includes("Your Facebook integration has expired. Please contact your admin.")) {
        document.querySelector("#notification_banner-btn-close")?.click();
      }
    
      if (!document.getElementById("notes-tab")) return;
      if (!document.querySelector('[name="contact.first_name"]')) return; // ensure data is loaded
      if (bannerDismissed) return;
  
      // check for facebook integration banner, close
      const el = document.querySelector('#notification_banner-content-crm-integration-facebook-expired');
      if (el) {
          const btn = document.querySelector('#notification_banner-btn-close');
          if (btn) {
              btn.click();
          }
          // el.parentNode?.parentNode?.remove();
      }
  
      // ensure property details is expanded
      const spans = document.querySelectorAll('span.text-sm.font-medium.text-gray-700.grow');
      const target = Array.from(spans).find(el => el.innerText.trim() === 'Property Details');
  
      const existingBanner = document.getElementById('notification_banner-top_bar');
  
      if (target) {
          const grandparent = target.parentElement?.parentElement;
          if (!grandparent) {
              cWarn('Grandparent not found.');
              return;
          }
  
          const pt3 = grandparent.querySelector('.pt-3');
          if (pt3) {
              cLog('Found .pt-3:', pt3);
          } else {
              // Click the nearest button or div that contains the SVG
              const svg = target.parentElement.querySelector('svg');
              if (svg) {
                  const clickable = svg.closest('button, div');
                  if (clickable && typeof clickable.click === 'function') {
                      clickable.click();
                      cLog('Clicked SVG container.');
                  } else {
                      cWarn('No clickable container found for SVG.');
                  }
              } else {
                  cWarn('SVG not found.');
              }
          }
      } else {
          cWarn('Target span with "Property Details" not found.');
      }
  
      const contactNoteJson = extractNoteData();
      if (!contactNoteJson) return;
  
      let sellerFirstName = document.querySelector('[name="contact.first_name"]')?.value || "";
      let sellerLastName = document.querySelector('[name="contact.last_name"]')?.value || "";
      let sellerPhone = document.querySelector('[name="contact.phone"]')?.value || "";
      let sellerUrgency = contactNoteJson.sellerUrgency || '';
      let sellerEmail = document.querySelector('[name="contact.email"]')?.value || "";
      let propertyAddressLine1 = document.querySelector('[name="contact.street_address"]')?.value || "";
      let propertyStreetName = getStreetName(propertyAddressLine1).trim() || "";
      let propertyStreetNumber = propertyAddressLine1.replace(propertyStreetName).trim() || "";
      let propertyCity = document.querySelector('[name="contact.property_city"]')?.value || "";
      let propertyStateShort = document.querySelector('[name="contact.state_property"]')?.value || document.querySelector('[name="contact.state"]')?.value || "";
      let propertyZip = document.querySelector('[name="contact.property_postal_code"]')?.value || "";
  
      bannerTextLeft = ''; // Initialize to reset on each call
      bannerTextCenterRight = ''; // Initialize to reset on each call
      bannerTextCenterLeft = ''; // Initialize to reset on each call
      bannerTextRight = ''; // Initialize to reset on each call
  
      if (sellerFirstName) {
          bannerTextLeft += sellerFirstName + (' ' + sellerLastName || '');
      }
  
      const addressParts = [];
  
      // Ensure street number and street name are combined without an extra comma
      // if (propertyStreetNumber && propertyStreetName) {
      //     addressParts.push(`${propertyStreetNumber} ${propertyStreetName}`);
      // } else {
      //     if (propertyStreetNumber) addressParts.push(propertyStreetNumber);
      //     if (propertyStreetName) addressParts.push(propertyStreetName);
      // }
  
      if (propertyAddressLine1) addressParts.push(propertyAddressLine1);
      // Add the rest of the address fields with a comma
      if (propertyCity) addressParts.push(propertyCity);
      if (propertyStateShort) addressParts.push(propertyStateShort);
      if (propertyZip) addressParts.push(propertyZip);
  
      // Filter out any undefined, null, or empty string values and join with a comma
      // let storedAddress = addressParts.filter(part => part && part.trim()).join(', ');
    let storedAddress = [
  propertyAddressLine1?.trim(),
  propertyCity?.trim(),
  [
    (propertyStateShort ?? '').toString().trim().slice(0,2).toUpperCase(),
    (propertyZip ?? '').toString().trim().split('-')[0] // strip ZIP+4
  ].filter(Boolean).join(' ').trim()
].filter(Boolean).join(', ');

  
      if (storedAddress) {
          // localStorage.setItem('propertyAddress', storedAddress);
          bannerTextLeft += `<br><b>${storedAddress}</b><i title="Click to copy address" class="fas fa-clipboard --dark copier zoomable" id="copyStoredAddressIcon" style="cursor:pointer; margin-left:5px;"></i>`;
  
          setTimeout(() => {
              const copyIcon = document.getElementById('copyStoredAddressIcon');
              if (copyIcon && !copyIcon.dataset.bound) {
                  copyIcon.dataset.bound = 'true';
                  copyIcon.addEventListener('click', () => {
                      navigator.clipboard.writeText(storedAddress).then(() => {
                          cLog('Address copied to clipboard:', storedAddress);
                      }).catch(err => {
                          cErr('Failed to copy: ' + err);
                      });
                  }, { once: true });
              }
          }, 10);
      }
  
      if (sellerUrgency) {
          bannerTextCenterLeft += ` Selling: <b>${sellerUrgency}</b>`;
      }
  
      if (sellerPhone) {
          const localTimeZone = getAreaCodeInfo(sellerPhone);
          bannerTextCenterLeft += ` <br>Local Time: <b>${localTimeZone[2]} (${localTimeZone[1]})</b><br>Local Area: <b>${localTimeZone[0]}</b>`;
      }
  
      if (storedAddress) {
          // cWarn('storedAddress', storedAddress);
          let normalizedAddress = normalizeAddress(storedAddress);
          let encodedNormalizedAddress = encodeURIComponent(normalizedAddress);
          let encoded = encodeURIComponent(storedAddress);
          const links = [
              `<a href="https://app.propstream.com/search?address=${encodedNormalizedAddress}" target="_blank">PropStream</a>`,
              `<a href="https://www.zillow.com/homes/${encoded}" target="_blank">Zillow</a>`,
              `<a href="https://www.redfin.com/zipcode/${propertyZip}/filter/include=sold-3mo" target="_blank">RedFin</a>`,
              `<a href="https://www.google.com/search?q=Trulia%20${encoded}" target="_blank">Trulia</a>`,
              `<a href="https://www.google.com/search?q=${encoded}" target="_blank">Google</a>`,
              `<a href="https://bing.com/maps/default.aspx?lvl=19&style=h&where1=${encoded}%20US" target="_blank">Bing</a>`,
              `<a href="https://www.google.com/search?q=Realtor%20${encoded}" target="_blank">Realtor</a>`,
              `<a href="https://id.land/discover?address=%20${encoded}" target="_blank">Land ID</a>`
          ];
          bannerTextLeft += `<br>${links.join(' | ')}`;
      }
  
      // Retrieve today's call data from localStorage
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
      // Retrieve the stored data
      const stored = JSON.parse(localStorage.getItem('totalCallsToday') || '{}');
  
      // Get today's data (if it exists)
      const todaysData = stored[today];
  
      if (todaysData) {
          const { calls, duration } = todaysData;
          // Use calls and duration in your banner
          bannerTextRight = `Calls: ${calls}`;
      } else {
          bannerTextRight = 'No data available for today.';
      }
  
      const counts = await extractContactData();
      // console.log('', counts);
      let dispo = await getDisposition();
  
      // Check if dispo is empty or "Move to Contacted"
      if (dispo === "" || dispo === "Move to Contacted") {
          // Apply red formatted text for the specific disposition
          bannerTextCenterRight = `
                  <table style="border-collapse: collapse; font-size: 12px;">
                      <thead>
                          <tr>
                              <th style="padding: 0 6px; text-align: left;"></th>
                              <th style="padding: 0 6px;">Calls</th>
                              <th style="padding: 0 6px;">Texts</th>
                              <th style="padding: 0 6px;">Voicemails</th>
                              <th style="padding: 0 6px;">Emails</th>
                          </tr>
                      </thead>
                      <tbody>
                          <tr>
                              <td style="padding: 0 6px; text-align: right;">Inbound</td>
                              <td style="padding: 0 6px; text-align: center;" id="inboundCallCount">${counts.calls.inbound.count}</td>
                              <td style="padding: 0 6px; text-align: center;" id="inboundSMSCount">${counts.sms.inbound.count}</td>
                              <td style="padding: 0 6px; text-align: center;">—</td>
                              <td style="padding: 0 6px; text-align: center;" id="inboundEmailCount">${counts.email.inbound.count}</td>
                          </tr>
                          <tr>
                              <td style="padding: 0 6px; text-align: right;">Outbound</td>
                              <td style="padding: 0 6px; text-align: center; ${counts.calls.outbound.count > 2 ? 'color: red; font-weight: bold;' : ''}" id="outboundCallCount">
                                  ${counts.calls.outbound.count}
                              </td>
                              <td style="padding: 0 6px; text-align: center; ${counts.sms.outbound.count === 'DND' ? 'color: red;' : (counts.sms.outbound.count > 2 ? 'color: red; font-weight: bold;' : '')}" id="outboundSMSCount">
                                  ${counts.sms.outbound.count === 'DND' ? 'DND' : counts.sms.outbound.count}
                              </td>
                              <td style="padding: 0 6px; text-align: center; ${counts.voicemail.outbound.count > 2 ? 'color: red; font-weight: bold;' : ''}" id="outboundVMCount">
                                  ${counts.voicemail.outbound.count}
                              </td>
                              <td style="padding: 0 6px; text-align: center; ${counts.email.outbound.count > 2 ? 'color: red; font-weight: bold;' : ''}" id="outboundEmailCount">
                                  ${counts.email.outbound.count}
                              </td>
                          </tr>
                          <tr>
                              <td style="padding: 0 6px; text-align: right;">Today</td>
                                <td style="padding: 0 6px; text-align: center;">${counts.calls.outbound.today.count || '—'}</td>
                                <td style="padding: 0 6px; text-align: center;">${counts.sms.outbound.today.count || '—'}</td>
                                <td style="padding: 0 6px; text-align: center;">${counts.voicemail.outbound.today.count || '—'}</td>
                                <td style="padding: 0 6px; text-align: center;">${counts.email.outbound.today.count || '—'}</td>
                          </tr>
                      </tbody>
                  </table>
              `;
      } else {
          // No red formatted text when dispo is anything else
          bannerTextCenterRight = `
              <table style="border-collapse: collapse; font-size: 12px;">
                  <thead>
                      <tr>
                          <th style="padding: 0 6px; text-align: left;"></th>
                          <th style="padding: 0 6px;">Calls</th>
                          <th style="padding: 0 6px;">Texts</th>
                          <th style="padding: 0 6px;">Voicemails</th>
                          <th style="padding: 0 6px;">Emails</th>
                      </tr>
                  </thead>
                  <tbody>
                      <tr>
                          <td style="padding: 0 6px; text-align: right;">Inbound</td>
                          <td style="padding: 0 6px; text-align: center;">${counts.calls.inbound.count}</td>
                          <td style="padding: 0 6px; text-align: center;">${counts.sms.inbound.count}</td>
                          <td style="padding: 0 6px; text-align: center;">—</td>
                          <td style="padding: 0 6px; text-align: center;">${counts.email.inbound.count}</td>
                      </tr>
                      <tr>
                          <td style="padding: 0 6px; text-align: right;">Outbound</td>
                          <td style="padding: 0 6px; text-align: center;">
                              ${counts.calls.outbound.count}
                          </td>
                          <td style="padding: 0 6px; text-align: center;">
                              ${counts.sms.outbound.count === 'DND' ? 'DND' : counts.sms.outbound.count}
                          </td>
                          <td style="padding: 0 6px; text-align: center;">
                              ${counts.voicemail.outbound.count}
                          </td>
                          <td style="padding: 0 6px; text-align: center;">
                              ${counts.email.outbound.count}
                          </td>
                      </tr>
                      <tr>
                          <td style="padding: 0 6px; text-align: right;">Today</td>
                          <td style="padding: 0 6px; text-align: center;">${counts.calls.outbound.today.count || '—'}</td>
                          <td style="padding: 0 6px; text-align: center;">${counts.sms.outbound.today.count || '—'}</td>
                          <td style="padding: 0 6px; text-align: center;">${counts.voicemail.outbound.today.count || '—'}</td>
                          <td style="padding: 0 6px; text-align: center;">${counts.email.outbound.today.count || '—'}</td>
                      </tr>
                  </tbody>
              </table>
          `;
      }
  
  
      // Compare with the time stripped out for non-time content, but allow changes if the time differs
      const middleCurrentStripped = stripTime(bannerTextCenterLeft.trim());
      const middleLastStripped = stripTime(lastBannerTextCenterLeft.trim());
      const middleTimeChanged = bannerTextCenterLeft.trim() !== lastBannerTextCenterLeft.trim();
      const middleIsSame = middleCurrentStripped === middleLastStripped;
  
      const leftChanged = bannerTextLeft.trim() !== lastBannerTextLeft.trim();
      const centerLeftChanged = bannerTextCenterLeft.trim() !== lastBannerTextCenterLeft.trim();
      const centerRightChanged = bannerTextCenterRight.trim() !== lastBannerTextCenterRight.trim();
      const rightChanged = bannerTextRight.trim() !== lastBannerTextRight.trim();
  
      // Only skip update if all parts are unchanged (ignoring middle time)
      const noChange = !leftChanged && !centerLeftChanged && !centerRightChanged && !rightChanged && middleIsSame && !middleTimeChanged;
  
      if (noChange) return;
  
  
      // Continue with the update process
      lastBannerTextLeft = bannerTextLeft; // Update saved version
      lastBannerTextCenterLeft = bannerTextCenterLeft; // Update saved version
      lastBannerTextCenterRight = bannerTextCenterRight; // Update saved version
      lastBannerTextRight = bannerTextRight; // Update saved version
  
  
      if (existingBanner) {
          const left = existingBanner.querySelector('#notification-banner-left');
          if (left) left.innerHTML = bannerTextLeft.trim();
  
          const centerLeft = existingBanner.querySelector('#notification-banner-center-left');
          if (centerLeft) centerLeft.innerHTML = bannerTextCenterLeft.trim();
  
          const centerRight = existingBanner.querySelector('#notification-banner-center-right');
          if (centerRight) centerRight.innerHTML = bannerTextCenterRight.trim();
  
          const right = existingBanner.querySelector('#notification-banner-right');
          if (right) right.innerHTML = bannerTextRight.trim();
  
          return;
      }
  
  
      // Build banner if it doesn't exist
      const bannerDiv = document.createElement('div');
      bannerDiv.id = 'notification_banner-top_bar';
      bannerDiv.setAttribute('role', 'region');
      bannerDiv.setAttribute('aria-label', 'Notification Banner');
      bannerDiv.className = 'notification-banner-top-bar';
  
      // Add appropriate styles and structure
      bannerDiv.style = `
              background-color: rgb(208, 248, 171);
              position: fixed;
              width: 100%;
              z-index: 999;
              min-height: 48px;
              top: 0;
              padding: 4px 12px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              gap: 24px;
              box-sizing: border-box;
              padding-right: 21%;
          `;
  
      bannerDiv.innerHTML = `
              <!-- LEFT SECTION -->
              <div id="notification-banner-left"
                   class="notification-banner-left text-sm text-gray-900"
                   style="flex: 0 0 40%; text-align: left; line-height: 1.5; overflow: hidden; padding: 0 38px; color: inherit;">
                  ${bannerTextLeft}
              </div>
  
              <!-- CENTER LEFT SECTION -->
              <div id="notification-banner-center-left"
                   class="notification-banner-center-left text-sm text-gray-900"
                   style="flex: 0 0 25%; text-align: left; white-space: nowrap; overflow: hidden; padding: 0 8px; color: inherit;">
                  ${bannerTextCenterLeft}
              </div>
  
              <!-- CENTER RIGHT SECTION -->
              <div id="notification-banner-center-right"
                   class="notification-banner-center-right text-sm text-gray-900"
                   style="flex: 0 0 20%; text-align: center; white-space: nowrap; overflow: hidden; padding: 0 8px; color: inherit;">
                  ${bannerTextCenterRight}
              </div>
  
              <!-- RIGHT SECTION -->
              <div id="notification-banner-right"
                   class="notification-banner-right text-sm text-gray-900"
                   style="flex: 0 0 15%; text-align: left; white-space: nowrap; overflow: hidden; padding: 0 30px; color: inherit;">
                  ${bannerTextRight}
              </div>
              <!-- Close Button -->
              <button id="notification_banner-btn-close" aria-label="Close notification"
                  class="w-7 h-7 flex items-center justify-center rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:enabled:bg-white/80"
                  style="position: absolute; top: 28px; left: 1%; z-index: 10001; color: inherit;">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="var(--gray-700)"
                      aria-hidden="true" class="w-5 h-5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M18 6L6 18M6 6l12 12" />
                  </svg>
              </button>
          `;
  
  
      // Close button click event
      bannerDiv.querySelector('#notification_banner-btn-close')?.addEventListener('click', () => {
          bannerDiv.remove();
          bannerDismissed = true;
      });
  
  
      // Insert the banner into the DOM
      const appContainer = document.querySelector('.container-fluid');
      if (appContainer?.parentNode) {
          appContainer.parentNode.insertBefore(bannerDiv, appContainer);
      }
  
      // no longer needed?
      const headerControls = document.querySelector('.hl_header--controls');
      if (headerControls && window.getComputedStyle(headerControls).zIndex !== '1000') {
          headerControls.style.zIndex = '1000';
      }
  }
  
  // === Script Checklist Menu ===
  async function addScriptChecklistMenu() {
      if (!ENABLE_MENU_BUTTONS) return;
  
      try {
          const existingScript = document.getElementById('tb_script_menu');
          if (document.getElementById("tb_script_menu")) return;
  
          // add the menu after
          const prevMenu = document.getElementById("tb_tasks");
          if (!prevMenu) return;
  
          const scriptButton = document.createElement('a');
          scriptButton.id = 'tb_script_menu';
          scriptButton.className = 'group text-left mx-1 pb-2 md:pb-3 text-sm font-medium topmenu-navitem cursor-pointer relative px-2';
          scriptButton.setAttribute('aria-label', 'Script Checklist');
          scriptButton.style.lineHeight = '1.6rem';
  
          scriptButton.innerHTML = `
                  <span class="flex items-center select-none">
                      Script Checklist
                      <svg xmlns="http://www.w3.org/2000/svg" class="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                  </span>
                  <div role="menu" id="scriptDropdown"
                       class="hidden origin-top-right absolute right-0 mt-2 w-96 rounded-md shadow-lg py-1 bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-40">
                  </div>
              `;
  
          const dropdown = scriptButton.querySelector('#scriptDropdown');
          dropdown.style.width = '48rem';
          dropdown.style.left = '0';
  
          // Toggle and render on click
          scriptButton.addEventListener('click', async (e) => {
              // dropdown.innerHTML = '';
              e.stopPropagation();
              closeOtherMenus('tb_script_menu');
  
              // Toggle dropdown visibility
              dropdown.classList.toggle('hidden');
  
              // Fetch data inside click
              const userInfo = await getUserData();
              if (!userInfo) return;
  
              let sellerFirstName = document.querySelector('[name="contact.first_name"]')?.value || "";
              let sellerEmail = document.querySelector('[name="contact.email"]')?.value || "";
              let propertyStreetName = getStreetName(document.querySelector('[name="contact.street_address"]')?.value) || "";
  
              let myFullName = '';
              let myFirstName = '';
              let myLastName = '';
              let myInitials = '';
              let myEmail = '';
              let myTele = '';
  
              if (userInfo && userInfo.myFirstName) {
                  myFullName = userInfo.myFirstName + ' ' + userInfo.myLastName;
                  myFirstName = userInfo.myFirstName;
                  myLastName = userInfo.myLastName;
                  myInitials = userInfo.myInitials;
                  myEmail = userInfo.myEmail;
                  myTele = userInfo.myTele;
              }
  
              let scriptLines = [];
  
              if (typeof propertyStreetName !== 'undefined' && propertyStreetName) {
                  scriptLines.push(
                      `Hello, is this ${sellerFirstName}? Hey ${sellerFirstName}, I was reaching out about ${propertyStreetName}, are you still looking to sell that property?`,
                      `  - [CALLING TOO OFTEN] I understand you get a lot of spam calls... You reached out because have a property to sell. 🛑`,
                      `  - [I'M WORKING] I completely understand. We work during normal business hours too, specifically 9 AM - 5 PM Eastern. I only need a few minutes to see if we can help you. 🛑`
                  );
              } else {
                  scriptLines.push(
                      `Hey ${sellerFirstName}, this is ${myFirstName}, Just reaching out because I saw you submitted your info about selling your property. Is now a bad time to talk?`,
                      `Hello, is this ${sellerFirstName}? Hey ${sellerFirstName}, I was reaching out to see if you are are you still looking to sell your property?`,
                      `  - [CALLING TOO OFTEN] I understand you get a lot of spam calls... You reached out because have a property to sell. 🛑`,
                      `  - [I'M WORKING] I completely understand. We work during normal business hours too, specifically 9 AM - 5 PM Eastern. I only need a few minutes to see if we can help you. 🛑`
                  );
              }
  
              scriptLines.push(
                  `How much are you needing to get for that property? [repeat back]`,
                  `[Not opening up] What is the condition of the property?`,
                  `What do you have going on?`,
                  `[High Price, High Motivation] What's more important to you? Speed of selling the property or return on investment?`,
                  `So, how did you come up with the price of XYZ?`,
                  `[Not opening up] How much do you think it would be after it's fixed up.`,
                  `[COMP] Check Google Street View`,
                  `[COMP] Check PropStream.com`,
                  `[COMP] Check Land ID`,
                  `[COMP] Check Redfin.com`,
                  `[COMP] Check Realtor.com`,
                  `[COMP] Check Zillow.com`,                
                  `If I covered all of the closing costs and there are no realtor commissions, what is the best price you can do for me?`,

                  `Checklist:`,
                  // `So what had you thinking about selling the property? [What's the situation over there?]`,
                  // `Why are you looking to sell?`,
                  `How soon are you looking to sell?`,
                  `Is it vacant, rented, or owner-occupied?`,
                  // `What condition is it in? [How are the roof, heating, and AC holding up?]`,
                  // `Are there any repairs or updates needed?`,
                  // `Honestly, I'm an investor. I need to buy this on a discount. I need some sort of exit strategy where I can make some money.`,
                  // `Okay, just so we’re on the same page — we buy as-is, pay cash, no agent fees, and close on your timeline. It’s not retail pricing, but we make it simple and fast. Does that sound like what you're looking for?`,
                  // `What do you think the property’s worth?`,
                  // `What’s the lowest you’d take if everything lined up and we paid cash?`,
                  `*** CLOSING ***`,
                  `If you and I can to an agreement on price today, I'm going to send you over a simple purchase agreement

Once you sign that agreement, we're going to come out, do an inspection of the property

And if the property is everything that you said it is then we'll be good to close at that price and on your timeline

But if something comes up unexpected, then we are going to have to revisit price and timeline. Does that make sense?

With that being said, if I were to cover all the closing costs, and there's no realtor commissions, and I'm buying it cash as-is condition, what's the best price you can do for me.`,
                  `---------------`,

                
                  //`Hey, it’s ${myFirstName} calling about the property you're looking to sell on ${propertyStreetName1}. Are you still looking for an as-is, cash offer? Great.`,
                  //`OPTIONAL: Hey, it’s ${myFirstName} calling about your property on ${propertyStreetName1}. Are you still looking to sell? Great.`,
                  // `Hey, I'm calling about your property on ${propertyStreetName}. I understand you're looking to sell? Great!`,
                  // `My name is ${myFirstName}. I'm with Cash Land Buyer USA. I buy properties for cash, as-is, and without commissions.`,
                  // `What’s got you thinking about selling the property?`,
                  // `Is this something you're hoping to sell quickly, or are you just exploring options for now?`,
                  // `What happens if it doesn’t sell in the next couple months?`,
                  // `If we could make the process easy and cover all the costs, what would you ideally want to walk away with?`,
                  // `Assuming no fees, no repairs, no surprises — what’s the number that actually solves the problem for you?`,
                  // "How do you come up with that price?",
                  // "** How would selling the property help?",
                  // "Why is it important to do this now?",
                  // "You're fair, we're fair",
                  // "A cluttered home has less value. You'll have to stage your home to get remotely close to your asking price. Plus realtor fees, closing costs, holding fees.",
                  // `The Zestimate from Zillow is based on comparable properties and market trends in the area. The Redfin estimate is derived from recent sales data and property features.`,
                  // `[Build Pain] Why did your taxes skyrocket in YEAR?`,
                  // `OVERPRICE / UNMOTIVATED (NO ASKING PRICE): Well there's no point in me even telling you my number because it would be far too low for you.`
              );
  
              // Populate dropdown
              // Populate dropdown without duplicating existing items
              scriptLines.forEach(line => {
                  const exists = Array.from(dropdown.children).some(child => child.textContent.trim() === line);
                  if (exists) return; // Skip if line already exists
  
                  const item = document.createElement('div');
                  item.textContent = line;
                  item.className = 'block w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 cursor-pointer flex items-center';
  
                  item.onclick = (event) => {
                      event.stopPropagation();
                      const existingIcon = item.querySelector('svg.check-icon');
                      if (existingIcon) {
                          existingIcon.remove();
                      } else {
                          const svgns = "http://www.w3.org/2000/svg";
                          const checkIcon = document.createElementNS(svgns, "svg");
                          checkIcon.setAttribute("viewBox", "0 0 20 20");
                          checkIcon.setAttribute("fill", "white");
                          checkIcon.setAttribute("class", "check-icon");
                          checkIcon.style.width = "20px";
                          checkIcon.style.height = "20px";
                          checkIcon.style.marginRight = "8px";
                          checkIcon.style.backgroundColor = "#22c55e";
                          checkIcon.style.borderRadius = "50%";
                          checkIcon.style.padding = "2px";
                          checkIcon.style.minWidth = "20px";
  
                          const path = document.createElementNS(svgns, "path");
                          path.setAttribute("fill-rule", "evenodd");
                          path.setAttribute("clip-rule", "evenodd");
                          path.setAttribute("d", "M16.707 5.293a1 1 0 010 1.414L8.414 15l-4.121-4.121a1 1 0 011.414-1.414L8.414 12.586l7.293-7.293a1 1 0 011.414 0z");
  
                          checkIcon.appendChild(path);
                          item.insertBefore(checkIcon, item.firstChild);
                      }
                  };
  
                  dropdown.appendChild(item);
              });
  
          });
  
          scriptButton.addEventListener('mouseleave', (e) => {
              // Add a small delay to allow movement into the dropdown
              setTimeout(() => {
                  if (!dropdown.matches(':hover') && !scriptButton.matches(':hover')) {
                      dropdown.classList.add('hidden');
                  }
              }, 150);
          });
  
          prevMenu.parentNode.insertBefore(scriptButton, prevMenu.nextSibling);
      } finally {
      }
  }
  
  
  async function addTextMessageMenu() {
      if (!ENABLE_MENU_BUTTONS) return;
      try {
  
          const notesTab = document.getElementById("notes-tab");
          const thisMenu = document.getElementById("tb_textmessage_menu");
          const prevMenu = document.getElementById("tb_script_menu");
  
          if (!prevMenu || !notesTab || thisMenu) return;
  
          const messageButton = document.createElement('a');
          messageButton.id = 'tb_textmessage_menu';
          messageButton.className = 'group text-left mx-1 pb-2 md:pb-3 text-sm font-medium topmenu-navitem cursor-pointer relative px-2';
          messageButton.setAttribute('aria-label', 'Text Message Menu');
          messageButton.style.lineHeight = '1.6rem';
          messageButton.innerHTML = `
                  <span class="flex items-center select-none">
                    Text Messages
                    <svg xmlns="http://www.w3.org/2000/svg" class="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                  <div role="menu" aria-orientation="vertical" tabindex="-1"
                      class="hidden origin-top-right absolute right-0 mt-2 rounded-md shadow-lg py-1 bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-40">
                  </div>
              `;
  
          const dropdown = messageButton.querySelector('div[role="menu"]');
          dropdown.style.width = '48rem';
          dropdown.style.left = '0';
  
          // Change the event to click instead of mouseenter
          messageButton.addEventListener('click', (event) => {
              // Prevent the menu from closing if the click is on a checkbox or inside the menu
              if (event.target.closest('.block')) {
                  event.stopPropagation(); // Prevent closing the menu if the target is part of the menu (like the checkbox)
              } else {
                  // const dropdown = messageButton.querySelector('div[role="menu"]');
                  dropdown.classList.toggle('hidden'); // Toggle visibility
                  renderMessageOptions(); // Render the message options when menu is clicked
              }
          });
  
          // Add a checkbox to auto-send messages if checked
          const autoSendCheckboxWrapper = document.createElement('div');
          autoSendCheckboxWrapper.className = 'block w-full px-4 py-2 text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100';
  
          const checkboxLabel = document.createElement('label');
          checkboxLabel.textContent = 'Auto-send Text Message';
  
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'mr-2';
          checkboxLabel.prepend(checkbox);
  
          autoSendCheckboxWrapper.appendChild(checkboxLabel);
          dropdown.appendChild(autoSendCheckboxWrapper);
  
          // Retrieve the stored state from localStorage and set checkbox
          const storedAutoSendState = localStorage.getItem('autoSendChecked');
          checkbox.checked = storedAutoSendState === 'true';
  
          // Save the checkbox state to localStorage when it changes
          checkbox.addEventListener('change', () => {
              localStorage.setItem('autoSendChecked', checkbox.checked);
          });
  
          async function sendMessageIfChecked(msg) {
              const input = document.querySelector('#text-message');
              const sendButton = document.querySelector('#send-sms');
  
              if (!input) return;
  
              let activeTab = document.querySelector('.nav-link.active');
              const smsTab = document.querySelector('#sms-tab');
  
              if (activeTab && activeTab.innerText.trim() !== 'SMS' && smsTab) {
                  smsTab.click();
                  await new Promise(resolve => setTimeout(resolve, 250));
              }
  
              input.value = msg;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
  
              activeTab = document.querySelector('.nav-link.active');
  
              if (checkbox.checked && sendButton && activeTab.innerText.trim() === 'SMS') {
                  setTimeout(() => sendButton.click(), 100);
              }
          }
  
          // ✅ Create floating modal that follows cursor
          const floatingModal = createFloatingModal({
              id: 'modal-sms',
              styles: {
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #ccc'
              },
              onUpdatePosition: (e, modal) => {
                  // Optional extra behavior on mouse move
              }
          });
  
          async function renderMessageOptions() {
              closeOtherMenus('tb_textmessage_menu');
              const userInfo = await getUserData();
              if (!userInfo) return;
  
              let sellerFirstNameRaw = document.querySelector('[name="contact.first_name"]')?.value || "";
              let sellerFirstName = sellerFirstNameRaw.replace(/\u00A0/g, ' ').trim();
              if (!sellerFirstName) sellerFirstName = "";
  
              let sellerEmail = document.querySelector('[name="contact.email"]')?.value || "";
              let propertyAddressLine1 = document.querySelector('[name="contact.street_address"]')?.value || "";
  
              let myFullName = '';
              let myFirstName = '';
              let myLastName = '';
              let myInitials = '';
              let myEmail = '';
              let myTele = '';
  
              if (userInfo && userInfo.myFirstName) {
                  myFullName = userInfo.myFirstName + ' ' + userInfo.myLastName;
                  myFirstName = userInfo.myFirstName;
                  myLastName = userInfo.myLastName;
                  myInitials = userInfo.myInitials;
                  myEmail = userInfo.myEmail;
                  myTele = userInfo.myTele;
              }
  
              //             const messageLines = [
              //                 `Hi ${sellerFirstName}, I’m reaching out about your property at ${propertyAddress}. I offer quick, hassle-free sales — cash offers, no fees, no cleanup, and flexible closing. What is the condition of the property?\n${myFirstName}`,
              //                 `Hi ${sellerFirstName}. I'm interested in making a cash offer for the property you're looking to sell at ${propertyAddress}. Can you tell me a bit more about it?\n${myFirstName}`,
              //                 `Hi ${sellerFirstName}, just following up about paying cash for the property at ${propertyAddress}. Is it still available?\n${myFirstName}`,
              //                 `Hi ${sellerFirstName}, is now a good time to chat about buying your property at ${propertyAddress}?\n${myFirstName}`,
              //                 `Hi ${sellerFirstName}. Can you let me know your asking price for ${propertyAddress}?\n${myFirstName}`,
              //                 `Hey ${sellerFirstName}, quick question. Why are you considering selling the place at ${propertyAddress}?\n${myFirstName}`,
              //                 `Hi ${sellerFirstName}, this is ${myFirstName} with Cash Land Buyer USA. Feel free to call or text me here, or if it’s easier, email me at ${myEmail}. Looking forward to working with you!`,
              //                 `Did we get disconnected on my end or did you mean to hang up?`,
              //                 `I've sent the contract to '${sellerEmail}'. If you don't see it at the top of your inbox, please check your junk folder.`,
              //                 `We buy fast, with cash, as-is\n- No agent commissions\n- No closing costs (we cover them)\n- No repair costs (we buy as-is)\n- No staging or cleaning expenses each time the property is shown\n- No showings\n- No inspection or appraisal fees\n- No deed transfer fees or lawyer fees\n- No holding costs (utilities, taxes, insurance, etc. while waiting to sell)\n- No listing fees or marketing expenses\n- No risk of buyer financing falling through\n`,
              //                 `Some companies say they’ll pay a lot just to get your attention. But when it’s time to sign papers, they lower the price. They do this to try and win over others, so be careful.`,
              //                 `I know the price might seem low, but remember, we have the cash, so we can close quickly. We buy as-is, cover the closing costs and holding fees, save you from realtor commissions, and eliminate the hassle of property showings.`,
              //                 `We put our offers in writing and don’t overprice, then undercut at the last minute like others may try to do.`,
              //                 `It’s normal to go back and forth on the price until we find something that feels fair for both sides. What price would you be willing to sell your property for?`
              //             ];
  
              const safePropertyAddress = (typeof propertyAddressLine1 !== 'undefined' && propertyAddressLine1) ? propertyAddressLine1 : 'your property';
  
              const messageLines = [
                  //`Hi ${sellerFirstName}, I’m reaching out about ${safePropertyAddress}. I offer quick, hassle-free sales — cash offers, no fees, no cleanup, and flexible closing. What is the condition of the property?\n${myFirstName}`,
                  `Hi ${sellerFirstName}, I'd like to buy ${safePropertyAddress}. When can we have a quick call?\n${myFirstName}`,
                  `Hi ${sellerFirstName}. I'm interested in making a cash offer for ${safePropertyAddress}. Can you tell me a bit more about it?\n${myFirstName}`,
                  `Hi ${sellerFirstName}, just following up about paying cash for ${safePropertyAddress}. Is it still available?\n${myFirstName}`,
                  `Hi ${sellerFirstName}, is now a good time to chat about buying ${safePropertyAddress}?\n${myFirstName}`,
                  `Hi ${sellerFirstName}. Can you let me know your asking price for ${safePropertyAddress}?\n${myFirstName}`,
                  `Hey ${sellerFirstName}, quick question. Why are you considering selling ${safePropertyAddress}?\n${myFirstName}`,
                  `Hi ${sellerFirstName}, this is ${myFirstName} with Cash Land Buyer USA. Feel free to call or text me here, or if it’s easier, email me at ${myEmail}. Looking forward to working with you!`,
                  `Did we get disconnected on my end or did you mean to hang up?`,
                  `Thanks again for taking the time to speak with me. I've sent the contract to ${sellerEmail}. Did you get it?`,
                  `We buy fast, with cash, as-is\n- No agent commissions\n- No closing costs (we cover them)\n- No repair costs (we buy as-is)\n- No staging or cleaning expenses each time the property is shown\n- No showings\n- No inspection or appraisal fees\n- No deed transfer fees or lawyer fees\n- No holding costs (utilities, taxes, insurance, etc. while waiting to sell)\n- No listing fees or marketing expenses\n- No risk of buyer financing falling through\n`,
                  `Some companies say they’ll pay a lot just to get your attention. But when it’s time to sign papers, they lower the price. They do this to try and win over others, so be careful.`,
                  `I know the price might seem low, but remember, we have the cash, so we can close quickly. We buy as-is, cover the closing costs and holding fees, save you from realtor commissions, and eliminate the hassle of property showings.`,
                  `We put our offers in writing and don’t overprice, then undercut at the last minute like others may try to do.`,
                  `It’s normal to go back and forth on the price until we find something that feels fair for both sides. What price would you be willing to sell your property for?`,
                  `Hi, it's ${myFirstName} with CLB. I tried calling back on and after our scheduled time, but I wasn't able to reach you. If you're no longer interested in the offer, just let me know so I can close out your file.`,
                  `Hey ${sellerFirstName}. Tried to return your call but wasn't able to reach you. I'll try you again in a bit, or you can text me if that's easier.`
              ];
  
  
              // Clear previous message options and dividers
              Array.from(dropdown.children).forEach(child => {
                  if (child.classList.contains('text-message-option') || child.tagName === 'HR') {
                      dropdown.removeChild(child);
                  }
              });
  
              // Setup tooltip once
              let tooltip = document.getElementById('tb-tooltip');
              if (!tooltip) {
                  tooltip = document.createElement('div');
                  tooltip.id = 'tb-tooltip';
                  tooltip.style.position = 'fixed';
                  tooltip.style.zIndex = '9999';
                  tooltip.style.background = 'black';
                  tooltip.style.color = 'white';
                  tooltip.style.padding = '5px 8px';
                  tooltip.style.borderRadius = '4px';
                  tooltip.style.fontSize = '12px';
                  tooltip.style.display = 'none';
                  document.body.appendChild(tooltip);
              }
  
              const sentMessages = Array.from(document.querySelectorAll('.message-bubble.cnv-message-bubble'))
              .map(el => el.innerText.replace(/[\r\n]+/g, ' ').trim().toLowerCase());
              const normalize = str =>
              str
              .toLowerCase()
              .replace(/[\r\n]+/g, ' ')       // remove newlines
              .replace(/\s+/g, ' ')           // collapse multiple spaces
              .replace(/\s+([.,?!])/g, '$1')  // remove space before punctuation
              .replace(/\s/g, '')             // remove all remaining spaces for comparison
              .trim();
  
              const normalizedSentMessages = sentMessages.map(m => normalize(m));
  
              messageLines.forEach((rawMessage, index) => {
                  let cleaned = cleanMessageText(rawMessage);
  
                  const normalized = normalize(cleaned);
                  const isSent = normalizedSentMessages.some(sent => sent === normalized || sent.includes(normalized));
  
                  const isMissingInfo =
                        rawMessage.includes('undefined') ||
                        rawMessage.includes('null') ||
                        rawMessage.includes("''");
  
                  const disabled = isSent || isMissingInfo;
  
                  const item = document.createElement('div');
                  item.innerHTML = cleaned.replace(/\n/g, '<br>');
                  floatingModal.attachHover(item, cleaned.replace(/\n/g, '<br>'));
  
                  // item.title = cleaned.replace(/\n/g, ' ');
                  item.className = 'text-message-option block w-full px-4 py-2 text-sm cursor-pointer hover:bg-gray-100';
  
                  if (disabled) {
                      item.style.color = 'gray';
                      item.style.opacity = '0.6';
                      item.style.cursor = 'not-allowed';
  
                      const reason = isSent ? 'Already sent' : 'Missing required info';
  
                      item.addEventListener('mouseover', e => {
                          tooltip.innerText = reason;
                          tooltip.style.left = `${e.pageX + 10}px`;
                          tooltip.style.top = `${e.pageY + 10}px`;
                          tooltip.style.display = 'block';
                      });
  
                      item.addEventListener('mousemove', e => {
                          tooltip.style.left = `${e.pageX + 10}px`;
                          tooltip.style.top = `${e.pageY + 10}px`;
                      });
  
                      item.addEventListener('mouseout', () => {
                          tooltip.style.display = 'none';
                      });
                  } else {
                      item.style.color = 'black';
                      item.onclick = () => {
                          sendMessageIfChecked(cleaned);
                          dropdown.classList.add('hidden');
                      };
                  }
  
                  dropdown.appendChild(item);
  
                  if (index < messageLines.length - 1) {
                      const hr = document.createElement('hr');
                      hr.style.width = '90%';
                      hr.style.margin = '8px auto';
                      hr.style.border = '1px solid #ddd';
                      dropdown.appendChild(hr);
                  }
              });
          }
  
  
          // Close menu when mouse leaves both button and dropdown
          dropdown.addEventListener('mouseleave', () => {
              if (!messageButton.matches(':hover')) {
                  dropdown.classList.add('hidden');
              }
          });
  
          prevMenu.parentNode.insertBefore(messageButton, prevMenu.nextSibling);
  
      } catch (error) {
          cErr("Error in addTextMessageMenu: " + error);
      } finally {
          // Optional: Any code to run after the function finishes (e.g., cleanup, logging, etc.)
      }
  }
  
  
  async function addTemplateMenu({
      menuId = 'tb_template_menu',
      menuLabel = 'Templates',
      rightOf = 'tb_tasks',
      type = null
  } = {}) {
      if (!ENABLE_MENU_BUTTONS) return;
  
      try {
          const prevMenu = document.getElementById(rightOf); // document.getElementById('tb_scripts_menu') || document.getElementById('tb_voicemail_menu') || document.getElementById('tb_email_menu') || document.getElementById('tb_sms_menu') ||document.getElementById("tb_tasks");
          const notesTab = document.getElementById("notes-tab");
          const existingMenu = document.getElementById(menuId);
  
          if (!prevMenu || !notesTab) return;
  
          if (existingMenu && type === 'email') {
              const emailInput = document.querySelector('[name="contact.email"]');
              if (emailInput && emailInput.value.trim() === '') {
                  attachTooltip(existingMenu, true, "No Email Address");
              } else {
                  detachTooltip(existingMenu);
              }
          }
  
          if (!existingMenu) {
              const menuLink = document.createElement('a');
              menuLink.id = menuId;
              menuLink.className = 'group text-left mx-1 pb-2 md:pb-3 text-sm font-medium topmenu-navitem cursor-pointer relative px-2';
              menuLink.setAttribute('aria-label', menuLabel);
              menuLink.style.lineHeight = '1.6rem';
  
              menuLink.innerHTML = `
                  <span class="flex items-center select-none">
                      ${menuLabel}
                      <svg xmlns="http://www.w3.org/2000/svg" class="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                  </span>
                  <div role="menu" class="hidden template-dropdown origin-top-right absolute right-0 mt-2 min-w-[18rem] rounded-md shadow-lg py-1 bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-40"></div>
              `;
  
              prevMenu.parentNode.insertBefore(menuLink, prevMenu.nextSibling);
  
              const wrapper = menuLink.querySelector('.template-dropdown');
              wrapper.style.width = '13rem';
              wrapper.style.left = '0';
  
              menuLink.addEventListener('click', async e => {
                  e.preventDefault();
                  closeOtherMenus(menuId);
  
                  if (wrapper.classList.contains('hidden')) {
                      // Show the menu
                      wrapper.removeAttribute('hidden');
  
                  }
                  wrapper.innerHTML = '';
  
                  if (type === 'sms') {
                      const autoSendCheckboxWrapper = document.createElement('div');
                      autoSendCheckboxWrapper.className = 'block w-full px-4 py-2 text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100';
  
                      const checkboxLabel = document.createElement('label');
                      checkboxLabel.textContent = 'Auto-send Text Message';
  
                      const checkbox = document.createElement('input');
                      checkbox.type = 'checkbox';
                      checkbox.className = 'mr-2';
                      checkboxLabel.prepend(checkbox);
  
                      autoSendCheckboxWrapper.appendChild(checkboxLabel);
                      wrapper.appendChild(autoSendCheckboxWrapper);
  
                      autoSendCheckboxWrapper.addEventListener('click', e => e.stopPropagation());
  
                      // Retrieve the stored state from localStorage and set checkbox
                      const storedAutoSendState = localStorage.getItem('autoSendChecked');
                      checkbox.checked = storedAutoSendState === 'true';
  
                      // Save the checkbox state to localStorage when it changes
                      checkbox.addEventListener('change', () => {
                          localStorage.setItem('autoSendChecked', checkbox.checked);
                      });
                  }
  
                  try {
                      const userInfo = await getUserData();
                      if (!userInfo) return;
  
                      let sellerFirstName = document.querySelector('[name="contact.first_name"]')?.value || "";
                      let sellerEmail = document.querySelector('[name="contact.email"]')?.value || "";
                      let propertyAddressLine1 = document.querySelector('[name="contact.street_address"]')?.value || "";
                      let propertyStreetName = getStreetName(document.querySelector('[name="contact.street_address"]')?.value) || "";
  
                      let myFullName = '';
                      let myFirstName = '';
                      let myLastName = '';
                      let myInitials = '';
                      let myEmail = '';
                      let myTele = '';
  
                      if (userInfo && userInfo.myFirstName) {
                          myFullName = userInfo.myFirstName + ' ' + userInfo.myLastName;
                          myFirstName = userInfo.myFirstName;
                          myLastName = userInfo.myLastName;
                          myInitials = userInfo.myInitials;
                          myEmail = userInfo.myEmail;
                          myTele = userInfo.myTele;
                      }
  
                      let menuData = {};
  
                      let floatingModal = document.getElementById(`${type}-modal`);
                      if (!floatingModal) {
                          floatingModal = createFloatingModal({
                              id: `${type}-modal`,
                              styles: {
                                  backgroundColor: '#f9f9f9',
                                  border: '1px solid #ccc',
                                  minWidth: '20rem',
                                  maxWidth: '20rem'
                              }
                          });
                      }
  
                      if (type === 'email') {
                          const signature = `
                              \n\nKind regards,
                              <strong>${myFullName}</strong> | Property Acquisition Officer<br>
                              <strong>Cash Land Buyer USA</strong><br>
                              📧 <a target="_blank" rel="noopener noreferrer nofollow" href="mailto:${myEmail}">${myEmail}</a><br>
                              📞 ${myTele}<br>
                              <a target="_blank" rel="noopener noreferrer nofollow" href="http://www.cashlandbuyerusa.com">www.cashlandbuyerusa.com</a>
                          `;
  
                          const safePropertyAddress = (typeof propertyAddressLine1 !== 'undefined' && propertyAddressLine1) ? propertyAddressLine1 : 'your property';
  
                          menuData = {
                              'Initial No Contact': {
                                  "Initial No Contact #1": {
                                      subject: `Regarding ${propertyAddressLine1}`,
                                      message: `Hi ${sellerFirstName},\n\nAre you still looking to sell your property?\n\nWe're ready to move forward when you are.${signature}`
                                  },
                                  "Initial No Contact #2": {
                                      subject: `Following up on ${propertyAddressLine1}`,
                                      message: `Hi ${sellerFirstName},\n\nI haven't heard back and wanted to see if you're still considering your options for selling the property.\n\nIf the timing isn’t right, that’s totally fine. I'd still appreciate a quick note so I know where things stand.${signature}`
                                  },
                                  "Initial No Contact #3": {
                                      subject: `Need to speak with you about ${propertyAddressLine1}`,
                                      message: `Hi ${sellerFirstName},\n\nI've reached out a few times and haven’t heard back. If you're still open to selling, I'd really like to reconnect and see if we're a fit.\n\nIf you’ve already made other plans, please let me know, and I'll respectfully stop contacting you.${signature}`
                                  }
                              },
                              'Pre-Sale Follow-Up': {
                                  "Pre-Sale Follow-Up #1": {
                                      subject: `Follow-up on contract sent`,
                                      message: `Hello ${sellerFirstName},\n\nI'm following up on the contract we sent. Let me know if you have any questions or concerns.\n\nYou can call or text me at ${myTele}.${signature}`
                                  },
                                  "Pre-Sale Follow-Up #2": {
                                      subject: `Second follow-up on contract`,
                                      message: `Hello ${sellerFirstName},\n\nJust checking in again on the contract. I'm happy to clarify anything if needed.\n\nFeel free to reach out at ${myTele}.${signature}`
                                  },
                                  "Pre-Sale Follow-Up #3": {
                                      subject: `Still interested in the contract?`,
                                      message: `Hello ${sellerFirstName},\n\nI haven’t heard back regarding the contract. If you’re still interested, I'm ready when you are.\n\nYou can reach me at ${myTele}.${signature}`
                                  }
                              },
                              'Advisor Change': {
                                  "Advisor Change #1": {
                                      subject: `Change of hands regarding ${safePropertyAddress}`,
                                      message: `Hello ${sellerFirstName},\n\nYou were previously working with my co-worker to sell your property. My name is ${myFullName} and I work for Cash Land Buyer USA. I'll be looking after you going forward.\n\nLet me know if you have any questions or concerns.\n\nYou can call or text me at ${myTele}.${signature}`
                                  }
                              },
                              'Add Signature': {
                                  "Signature #1": {
                                      subject: ``,
                                      message: `\n\nKind regards,
                                               <strong>${myFullName}</strong> | Property Acquisition Officer<br>
                                               <strong>Cash Land Buyer USA</strong><br>
                                               📧 <a target="_blank" rel="noopener noreferrer nofollow" href="mailto:${myEmail}">${myEmail}</a><br>
                                               📞 ${myTele}<br>
                                               <a target="_blank" rel="noopener noreferrer nofollow" href="http://www.cashlandbuyerusa.com">www.cashlandbuyerusa.com</a>`
                                  }
                              }
                          };
                      } else if (type === 'sms') {
                          const safePropertyAddress = (typeof propertyAddressLine1 !== 'undefined' && propertyAddressLine1) ? propertyAddressLine1 : 'your property';
  
                          menuData = {
                              'Initial Outreach': {
                                  //     'No Contact #1 (Condition Inquiry)': {
                                  //         message: `Hi ${sellerFirstName}, I’m reaching out about ${safePropertyAddress}. I offer quick, hassle-free sales — cash offers, no fees, no cleanup, and flexible closing. What is the condition of the property?\n${myFirstName}`
                                  //     },
                                  'No Contact #0 (Generic)': {
                                      message: `Hi ${sellerFirstName}. Are you still looking to sell ${safePropertyAddress}?\n\n`
                                  },
                                  'No Contact #1 (Condition Inquiry)': {
                                      message: `Hi ${sellerFirstName}, I'm looking to buy ${safePropertyAddress}. When can we have a quick call?\n${myFirstName}`
                                  },
                                  'No Contact #2 (Basic Cash Offer Ask)': {
                                      message: `Hi ${sellerFirstName}. I'm interested in making an offer for ${safePropertyAddress}. When can I give you a call to discuss it further?\n${myFirstName}`
                                  },
                                  'No Contact #3 (Still Available?)': {
                                      message: `Hi ${sellerFirstName}, just following up about paying cash for ${safePropertyAddress}. Is it still available?\n${myFirstName}`
                                  },
                                  'No Contact #4 (Quick Chat Request)': {
                                      message: `Hi ${sellerFirstName}, is now a good time to chat about buying ${safePropertyAddress}?\n${myFirstName}`
                                  },
                                  'No Contact #5 (Asking Price)': {
                                      message: `Hi ${sellerFirstName}. Can you let me know your asking price for ${safePropertyAddress}?\n${myFirstName}`
                                  },
                                  'No Contact #6 (Preferred Communication)': {
                                      message: `Hi ${sellerFirstName}, would you rather text or talk on the phone about ${safePropertyAddress}? I’m good either way.\n${myFirstName}`
                                  },
                                  'Reason for Selling': {
                                      message: `Hey ${sellerFirstName}, quick question. Why are you considering selling ${safePropertyAddress}?\n${myFirstName}`
                                  },
                                  'Intro with Contact Info': {
                                      message: `Hi ${sellerFirstName}, this is ${myFirstName} with Cash Land Buyer USA. Feel free to call or text me here, or if it’s easier, email me at ${myEmail}. Looking forward to working with you!`
                                  }
                              },
                              'Disconnected': {
                                  'Disconnected?': {
                                      message: `Did we get disconnected on my end or did you mean to hang up?\n\nIf you don't want to speak with me to sell your property, that's okay. I just need to know.`
                                  }
                              },
                              'Follow-Up': {
                                  'Contract - Not Opened #1': {
                                      message: `Hi ${sellerFirstName}. I noticed our offer wasn't opened. Can you please confirm that you received our email?`
                                  },
                                  'Contract - Not Opened #2': {
                                      message: `Hi ${sellerFirstName}. Do you have any questions about the contract we sent over?`
                                  },
                                  'Sent Contract Confirm': {
                                      message: `Thanks again for taking the time to speak with me. I've sent the contract to ${sellerEmail}. Did you get it?`
                                  },
                                  'Friendly Bump': {
                                      message: `Hi ${sellerFirstName}, just circling back on ${safePropertyAddress}. I’m still interested if you are. Let me know either way.\n${myFirstName}`
                                  },
                                  'Still Considering?': {
                                      message: `Hey ${sellerFirstName}, I understand if you’re not ready to decide yet. Just checking if you're still open to selling ${safePropertyAddress}?\n${myFirstName}`
                                  },
                                  'Wrong Number Check': {
                                      message: `Hi, I’m trying to reach ${sellerFirstName} about ${safePropertyAddress}. If this isn’t the right number, I apologize!`
                                  }
                              },
                              'Offer Context': {
                                  'Why Us (no fees)': {
                                      message: `We buy fast, with cash, as-is\n- No agent commissions\n- No closing costs (we cover them)\n- No repair costs (we buy as-is)\n- No staging or cleaning expenses each time the property is shown\n- No showings\n- No inspection or appraisal fees\n- No deed transfer fees or lawyer fees\n- No holding costs (utilities, taxes, insurance, etc. while waiting to sell)\n- No listing fees or marketing expenses\n- No risk of buyer financing falling through\n`
                                  },
                                  'Bait-and-Switch Warning': {
                                      message: `Some companies say they’ll pay a lot just to get your attention. But when it’s time to sign papers, they lower the price. They do this to try and win over others, so be careful.`
                                  },
                                  'Justification of Offer': {
                                      message: `I know the price might seem low, but remember, we have the cash, so we can close quickly. We buy as-is, cover the closing costs and holding fees, save you from realtor commissions, and eliminate the hassle of property showings.`
                                  },
                                  'No Underpricing Tricks': {
                                      message: `We put our offers in writing and don’t overprice, then undercut at the last minute like others may try to do.`
                                  },
                                  'Price Negotiation Opener': {
                                      message: `It’s normal to go back and forth on the price until we find something that feels fair for both sides. What price would you be willing to sell your property for?`
                                  }
                              },
                              'Process Summary': {
                                  'Process Summary': {
                                      message: `Quick overview: We handle everything — pay in cash, cover closing costs, and buy as-is. You don’t need to clean, fix, or show the property.`
                                  },
                                  'How It Works': {
                                      message: `Once we agree on a price, I send a simple contract and close at a local title company. No pressure. Just info if you're considering selling.`
                                  },
                                  'Market vs Cash Comparison': {
                                      message: `Selling with a realtor could take 90+ days. I can close in under 2 weeks if it works for you. No open houses, no listings.`
                                  }
                              },
                              'Final Attempts': {
                                  'Missed Scheduled Call': {
                                      message: `Hi, it's ${myFirstName} with CLB. I tried calling back on and after our scheduled time, but I wasn't able to reach you. If you're no longer interested in the offer, just let me know so I can close out your file for now and reach out at a later date.`
                                  },
                                  'Inbound Call Follow-Up': {
                                      message: `Hey ${sellerFirstName}. Tried to return your call but wasn't able to reach you. I'll try you again in a bit, or you can text me if that's easier.`
                                  },
                                  'Closing File Soft Exit': {
                                      message: `Hi ${sellerFirstName}, I don’t want to keep bothering you. If I don’t hear back, I’ll assume you’re not interested and close your file. No hard feelings at all. I'll try reaching out again in the near future.`
                                  },
                                  'Expiring (FOMO)': {
                                      message: `Hi ${sellerFirstName}. Our offer is about to expire. Don't miss out! Call or text me when you can.`
                                  }
                              },
                              'Advisor Change': {
                                  'Intro': {
                                      message: `Hi ${sellerFirstName}. You were speaking with my co-worker previously about selling your property. My name is ${myFirstName} and I'll be looking after you going forward. What questions can I answer for you?`
                                  }
                              },
                              'Last Ditch': {
                                  'Last Ditch': {
                                      message: `If they try to low-ball you at the very last moment, don't feel obligated to take it.\nLet me know immediately and I will make sure you get a fair deal.`
                                  }
                              },
                              'Contract Clarification': {
                                  '$10 Earnest': {
                                      message: `The $10 is just to open escrow and make the contract binding. The full amount will be paid at closing, but the $10 is what’s used to officially start the process.`
                                  }
                              }
                          };
                      } else if (type === 'voicemail') {
                          const hasStreetName = propertyStreetName && propertyStreetName.trim() !== '';
                          const suffix = hasStreetName ? ` on ${propertyStreetName}` : '';
                          const propMention = hasStreetName ? ` your property on ${propertyStreetName}` : ' your property';
  
                          menuData = {
                              'Initial No Contact': {
                                  'Generic No Contact': {
                                      //message: `Hello ${sellerFirstName}, this is ${myFirstName} from Cash Land Buyer USA. I understand you're interested in selling${propMention}. I make cash offers. I buy as-is, and can close very quickly with no commissions, no repairs, and no inconvenient property showings. I'm very interested in discussing this further with you so you can call or text me directly at ${myTele} and we'll see what we can do for you. Looking forward to hearing from you soon!`
                                      // message: `Hello ${sellerFirstName}, this is ${myFirstName} from Cash Land Buyer USA. I'm looking to purchase ${propMention}. Please give me a call when you're free, my direct number is ${myTele}. Looking forward to hearing from you soon! Have a great day!`
                                      message: `Hi. My name is ${myFirstName}. I'm looking to purchase the property you have for sale. Please give me a call. My number is ${myTele}. Thank you!`
                                  },
                                  'Initial No Contact': {
                                      //message: `Hello ${sellerFirstName}, this is ${myFirstName} from Cash Land Buyer USA. I understand you're interested in selling${propMention}. I make cash offers. I buy as-is, and can close very quickly with no commissions, no repairs, and no inconvenient property showings. I'm very interested in discussing this further with you so you can call or text me directly at ${myTele} and we'll see what we can do for you. Looking forward to hearing from you soon!`
                                      // message: `Hello ${sellerFirstName}, this is ${myFirstName} from Cash Land Buyer USA. I'm looking to purchase ${propMention}. Please give me a call when you're free, my direct number is ${myTele}. Looking forward to hearing from you soon! Have a great day!`
                                      message: `Hi ${sellerFirstName}, my name is ${myFirstName}. I'm looking to purchase ${propMention}. Please give me a call. My number is ${myTele}. Thanks!`
                                  },
                                  'Second No Contact': {
                                      // message: `Hi ${sellerFirstName}, this is ${myFirstName} from Cash Land Buyer USA following up on my previous message about${propMention}. I wanted to see if you had any questions or if you're still considering selling and if you are, I'll make the process as easy as possible for you. I'm very interested in discussing this further with you so you can call or text me directly at ${myTele} and we'll see what we can do for you. Looking forward to hearing from you soon.`
                                      //message: `Hello ${sellerFirstName}, this is ${myFirstName} from Cash Land Buyer USA. I'm following up on purchasing ${propMention}. Please give me a call when you have a free moment, my direct number is ${myTele}. Looking forward to hearing from you soon! Have a great day!`
                                      message: `Hi ${sellerFirstName}, this is ${myFirstName} calling you back about buying ${propMention}. Please give me a call. My number is ${myTele}. Thanks!`
                                  },
                                  'Third No Contact': {
                                      // message: `Hi ${sellerFirstName}, this is ${myFirstName} from Cash Land Buyer USA. I've reached out a few times regarding${propMention} and haven’t heard back. If you're still serious about selling, please get in touch as soon as possible to discuss how we can proceed. You can call or text me directly at ${myTele}. If I don't hear from you soon, I'll assume you're no longer interested. Thanks.`
                                    message: `Hi ${sellerFirstName}, this is ${myFirstName} calling you back about buying ${propMention}. I haven't heard back from you. Please give me a call. My number is ${myTele}. Thanks!`
                                  }
                              },
                              'Pre-Sale Follow-Up': {
                                  'Contract Sent Check-in #1': {
                                      message: `Hello ${sellerFirstName}, this is ${myFirstName}. I’m following up on the contract we sent${suffix}. Let me know if you have any questions or concerns. Call/text me at ${myTele}.`
                                  },
                                  'Contract Sent Check-in #2': {
                                      message: `Hello ${sellerFirstName}, this is ${myFirstName}. I’m following up on the contract we sent${suffix}. Let me know if you have any questions or concerns. Call/text me at ${myTele}.`
                                  },
                                  'Ghosting - Contract Sent': {
                                      message: `Hello ${sellerFirstName}, this is ${myFirstName}. I’m following up on the contract we sent${suffix}. Let me know if you have any questions or concerns. Call/text me at ${myTele}.`
                                  }
                              },
                              'Advisor Change': {
                                  'Advisor Change #1': {
                                      message: `Hello ${sellerFirstName}, this is ${myFirstName}. You were previously working with my colleague. I’ll be looking after you going forward. I was just calling to introduce myself and to see if you had any questions. Please reach out and I'll be happy to help you out. You can call or text me directly at ${myTele}. Looking forward to working with you! Have a great day!`
                                  },
                                  'Contract Sent Check-in #2': {
                                      message: `Hello ${sellerFirstName}, this is ${myFirstName}. I’m following up on the contract we sent${suffix}. Let me know if you have any questions or concerns. Call/text me at ${myTele}.`
                                  },
                                  'Ghosting - Contract Sent': {
                                      message: `Hello ${sellerFirstName}, this is ${myFirstName}. I’m following up on the contract we sent${suffix}. Let me know if you have any questions or concerns. Call/text me at ${myTele}.`
                                  }
                              }
                          };
                      }
  
  
  
  
                      for (const [group, templates] of Object.entries(menuData)) {
                          const groupWrapper = document.createElement('div');
                          groupWrapper.className = 'relative group submenu-wrapper';
                          groupWrapper.innerHTML = `
                              <button class="flex justify-between items-center w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 submenu-button">
                                  <span>${group}</span>
                                  <span style="font-size: 0.75rem; color: #6b7280; padding-left: 10px;">▶</span>
                              </button>
                              <div class="hidden template-panel"></div>
                          `;
  
                          const panel = groupWrapper.querySelector('.template-panel');
  
                          for (const [label, { subject = '', message }] of Object.entries(templates)) {
                              const buttonItem = document.createElement('div');
                              buttonItem.className = 'text-sm px-4 py-2 hover:bg-gray-100 text-gray-800 cursor-pointer';
                              buttonItem.textContent = label;
  
                              let handleClick = () => console.warn(`Unhandled template type: ${type}`);
  
                              // const cleanedMessage = typeof message === 'string' ? cleanMessageText(message) : '';
                              let cleanedMessage = '';
  
                              if (type === 'email') {
                                  cleanedMessage = typeof message === 'string' ? cleanMessageEmail(message) : '';
  
                                  handleClick = async () => {
                                      const activeTab = document.querySelector('.nav-link.active');
                                      const emailTab = document.querySelector('#email-tab');
                                      if (activeTab && activeTab.innerText.trim() !== 'Email' && emailTab) {
                                          emailTab.click();
                                          await new Promise(resolve => setTimeout(resolve, 1500));
                                      }
  
                                      const composer = document.querySelector('#message-composer');
                                      const subjectField = composer?.querySelector('#subject');
                                      const editor = composer?.querySelector('.tiptap.ProseMirror');
  
                                      if (subjectField) setInputValue(subjectField, subject, 'email-template');
                                      if (editor) {
                                          editor.innerHTML = cleanedMessage
                                              .split('\n')
                                              .map(p => `<p>${p}</p>`)
                                              .join('');
                                      }
  
                                      floatingModal.remove();
                                      wrapper.setAttribute('hidden', '');
                                  };
                              }
  
                              if (type === 'sms') {
                                  cleanedMessage = typeof message === 'string' ? cleanMessageText(message) : '';
  
                                  handleClick = async () => {
                                      let activeTab = document.querySelector('.nav-link.active');
                                      const smsTab = document.querySelector('#sms-tab');
  
                                      if (activeTab && activeTab.innerText.trim() !== 'SMS' && smsTab) {
                                          smsTab.click();
                                          await new Promise(resolve => setTimeout(resolve, 250));
                                      }
  
                                      const input = document.querySelector('#text-message');
                                      const sendButton = document.querySelector('#send-sms');
                                      if (!input) return;
  
                                      setInputValue(input, cleanedMessage, 'smsMsg');
  
                                      activeTab = document.querySelector('.nav-link.active');
  
                                      // Check for the checkbox by ID or wrapper scope
                                      const checkbox = wrapper.querySelector('input[type="checkbox"]');
                                      if (checkbox?.checked && sendButton && activeTab.innerText.trim() === 'SMS') {
                                          setTimeout(() => sendButton.click(), 100);
                                      }
  
                                      floatingModal.remove();
                                      wrapper.setAttribute('hidden', '');
                                  };
  
                              }
  
                              if (type === 'voicemail') {
                                  cleanedMessage = typeof message === 'string' ? cleanMessageText(message) : '';
  
                                  handleClick = () => {
                                      const textarea = document.querySelector('#voicemail-note');
                                      if (textarea) {
                                          setInputValue(textarea, cleanedMessage, 'vm-template');
                                      }
  
                                      floatingModal.remove();
                                      wrapper.setAttribute('hidden', '');
                                  };
                              }
  
                              buttonItem.addEventListener('click', handleClick);
  
                              // Attach hover preview (if modal is supported for this type)
                              if (floatingModal && typeof floatingModal.attachHover === 'function') {
                                  if (typeof cleanedMessage === 'string') {
                                      const preview = cleanedMessage.replace(/\n/g, '<br>');
                                      floatingModal.attachHover(buttonItem, preview, handleClick);
                                  }
                              }
  
                              panel.appendChild(buttonItem);
                          }
  
                          wrapper.appendChild(groupWrapper);
                      }
  
                      wrapper.querySelectorAll('.submenu-wrapper').forEach(wrap => {
                          const button = wrap.querySelector('button');
                          const panel = wrap.querySelector('.template-panel');
  
                          Object.assign(panel.style, {
                              fontFamily: 'inherit',
                              fontSize: '0.875rem',
                              lineHeight: '1.25rem',
                              padding: '0.5rem',
                              maxWidth: '500px',
                              backgroundColor: '#ffffff',
                              border: '1px solid #d1d5db',
                              borderRadius: '0.375rem',
                              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.1)',
                              zIndex: '9999',
                              position: 'fixed',
                              display: 'none',
                              whiteSpace: 'normal',
                              color: '#374151'
                          });
  
                          wrap.addEventListener('mouseenter', () => {
                              const rect = button.getBoundingClientRect();
                              panel.style.top = `${rect.top + window.scrollY}px`;
                              panel.style.left = `${rect.right + window.scrollX}px`;
                              panel.style.display = 'block';
                          });
  
                          wrap.addEventListener('mouseleave', () => {
                              panel.style.display = 'none';
                          });
                      });
  
                  } finally {
                      wrapper.classList.toggle('hidden');
                  }
              });
          }
      } catch (err) {
          cErr(`Error in ${menuId}: ${err}`);
      }
  }
  
  
  
  
  async function addQuickNotesMenu() {
      if (!ENABLE_MENU_BUTTONS) return;
      if (document.getElementById('tb_addnote_menu')) return;
      if (!document.getElementById("notes-tab")) return;
      if (!document.getElementById('notification_banner-top_bar')) return;
  
      const voicemailBtn = document.getElementById('tb_voicemail_menu');
      if (!voicemailBtn || !voicemailBtn.parentNode) return;
  
      const noteButton = document.createElement('a');
      noteButton.id = 'tb_addnote_menu';
      noteButton.className = 'group text-left mx-1 pb-2 md:pb-3 text-sm font-medium topmenu-navitem cursor-pointer relative px-2';
      noteButton.setAttribute('aria-label', 'Add Note Menu');
      noteButton.style.lineHeight = '1.6rem';
      noteButton.style.zIndex = '1000';
      noteButton.innerHTML = `
          <span class="flex items-center select-none">
              Quick Notes
              <svg xmlns="http://www.w3.org/2000/svg" class="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
          </span>
          <div role="menu" aria-orientation="vertical" tabindex="-1"
              class="hidden origin-top-right absolute right-0 mt-2 w-96 rounded-md shadow-lg py-1 bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-40">
          </div>
      `;
  
      // ✅ Create floating modal that follows cursor
      const floatingModal = createFloatingModal({
          id: 'quicknotes-modal',
          styles: {
              backgroundColor: '#f9f9f9',
              border: '1px solid #ccc'
          },
          onUpdatePosition: (e, modal) => {
              // Optional extra behavior on mouse move
          }
      });
  
  
      const dropdown = noteButton.querySelector('div[role="menu"]');
      dropdown.style.width = '26rem';
      dropdown.style.left = '0';
  
      async function renderNoteOptions() {
          try {
              closeOtherMenus('tb_addnote_menu');
              dropdown.innerHTML = '';
  
              const userInfo = await getUserData();
              if (!userInfo) return;
  
              let sellerEmail = document.querySelector('[name="contact.email"]')?.value || "";
              const counts = await extractContactData();
              console.log('counts', counts);
  
              const smsText = counts.sms.outbound.count === "DND"
              ? "SMS (DND)"
              : counts.sms.outbound.today.count
              ? `Sent SMS (Total: ${counts.sms.outbound.count})`
              : `No SMS sent (Total: ${counts.sms.outbound.count})`;
  
              const emailText = sellerEmail
              ? (counts.email.outbound.today.count
                 ? `Sent email (Total: ${counts.email.outbound.count})`
                 : `No email sent (Total: ${counts.email.outbound.count})`)
              : "Cannot email (no email address)";
  
              const noteOptions = [];
  
              let dispo = await getDisposition();
            
              // Check if dispo is empty or "Move to Contacted"
              if (dispo === "Unable to reach") {
                  noteOptions.push({
                      name: 'Lost Follow-Up',
                      text: `${dispo} call back. No answer.`,
                      nextAccount: true,
                      autoSave: true
                  });
              }
  
  
              if (dispo === "" || dispo === "Move to Contacted" || dispo === "Move to Final Contact" || dispo === "Move to Hot Lead" || dispo === "Move to Nutured" || dispo === "Move to Initial Offer Made" || dispo === "Wholesaler") {
                  //if (counts.calls.outbound.count >= 2 && (counts.sms.outbound.count >= 2 || counts.sms.outbound.count === "DND")) {
                if (counts.calls.outbound.count >= 5) {
                      noteOptions.push({
                          name: 'Move to Unable to Reach',
                          text: `Call attempt #${counts.calls.outbound.count} - Unable to reach.\nTotal Voicemail: ${counts.voicemail.outbound.count}\nTotal SMS: ${counts.sms.outbound.count}\nTotal Email: ${counts.email.outbound.count} <br><font size=-1 color=red>(Automatically moves to 'Unable to reach')</font>`,
                          dispo: 'Unable to reach',
                          nextAccount: true,
                          autoSave: true
                      });
                  }
              }
  
              if (counts.voicemail.outbound.count === 0) {
                  noteOptions.push({
                      name: 'Left Voicemail',
                      text: `Call attempt #${counts.calls.outbound.count}\nLeft voicemail (Total: 1)\n${smsText}\n${emailText}`,
                      dispo: 'Move to Contacted',
                      nextAccount: true,
                      autoSave: true
                  });
              } else {
                  noteOptions.push({
                      name: 'Left Voicemail',
                      text: `Call attempt #${counts.calls.outbound.count}\nLeft voicemail (Total: ${counts.voicemail.outbound.count})\n${smsText}\n${emailText}`,
                      dispo: 'Move to Contacted',
                      nextAccount: true,
                      autoSave: true
                  });
              }
  
              noteOptions.push(
                  {
                      name: 'No Voicemail Left',
                      text: `Call attempt #${counts.calls.outbound.count}\nNo voicemail left (Total: ${counts.voicemail.outbound.count})\n${smsText}\n${emailText}`,
                      dispo: 'Move to Contacted',
                      nextAccount: true,
                      autoSave: true
                  },
                  {
                      name: 'Could Not Leave Voicemail',
                      text: `Call attempt #${counts.calls.outbound.count}\nCould not leave voicemail (Total: ${counts.voicemail.outbound.count})\n${smsText}\n${emailText}`,
                      dispo: 'Move to Contacted',
                      nextAccount: true,
                      autoSave: true
                  },
                  {
                      name: 'Standard Questions',
                      text: `Motivation Level: \nMotivation Reason(s): \n Asking Price: \nCMV: \nOur Offer: \nTimeline: \n\nRepairs: \nRenovations: \n`,
                      autoSave: false
                  },
                  {
                      name: 'Post Purchase Notes',
                      text: `Purchase price: $ \nName of seller: \nProperty address: \n - Long/Lat: \nCondition of the property: \nPictures: \+/- value factors: \nVacant: \n - If tenant occupied, are they staying? \nHow do we access the property: \nDetails added to deal tracker: `,
                      autoSave: false
                  },
                  {
                      name: 'Made Contact',
                      text: `Call attempt #${counts.calls.outbound.count}\nMade contact.`,
                      autoSave: false
                  },
                  {
                      name: 'Appointment set',
                      text: "Appointment set.",
                      autoSave: false
                  },
                  {
                      name: 'Call blocked',
                      text: "Blocked by screening service",
                      dispo: 'Unable to reach',
                      nextAccount: true,
                      autoSave: true
                  },
                  {
                      name: 'Rental Questions',
                      text: `Rent Collected: \nTaxes: \nInsurance: \nUtilites: \nMaintenance Manager: \nMaintenance Costs: \n\nVacancy in the past 12 months: \n`,
                      autoSave: false
                  },
                  sellerEmail ? {
                      name: 'Contract Sent',
                      text: `Contract sent to ${sellerEmail}. <br><font size=-1 color=red>(Automatically moves to 'Move to Intial Offer Made')</font>`,
                      dispo: `Move to Initial Offer Made`,
                      autoSave: false
                  } : null,
                  {
                      name: 'Not Looking to Sell',
                      text: "Contact explicitly expressed they are not looking to sell <br><font size=-1 color=red>(Automatically moves to 'Fake Lead')</font>",
                      dispo: 'Fake Lead',
                      nextAccount: true,
                      autoSave: true
                  },
                  {
                      name: 'Does Not Wish to Proceed',
                      text: "Seller does not wish to proceed.\nREASON:",
                      autoSave: false
                  },
                  {
                      name: 'DNC',
                      text: "Seller is on the DNC list. <br><font size=-1 color=red>(Automatically moves to 'Fake Lead')</font>",
                      dispo: 'Fake Lead',
                      nextAccount: true,
                      autoSave: true
                  }
              );
  
              const cleanNotes = noteOptions.filter(Boolean).map(note => ({
                  name: note.name,
                  text: note.text.trim(),
                  dispo: note.dispo || null,
                  nextAccount: note.nextAccount || null,
                  autoSave: note.autoSave
              }));
  
              cleanNotes.forEach(({ name, text, dispo, nextAccount, autoSave }) => {
                  const noteButtonItem = document.createElement('button');
                  noteButtonItem.className = 'block w-full text-left px-4 py-2 text-sm text-gray-700';
                  noteButtonItem.innerHTML = name;
  
                  floatingModal.attachHover(noteButtonItem, text.replace(/\n/g, '<br>'));
  
                  noteButtonItem.addEventListener('click', () => {
                      const textareaSelector = 'textarea[class*="input__textarea-el"]';
                      const saveButtonSelector = "#notes-form-save-btn";
  
                      function setTextareaValue(el, newText) {
                          el.value = newText;
                          el.dispatchEvent(new Event("input", { bubbles: true }));
                          el.dispatchEvent(new Event("change", { bubbles: true }));
                      }
  
                      function handleNoteInsert(el, noteText) {
                          const existingText = el.value.trim();
                          if (existingText.includes(noteText)) return;
  
                          // const autoSaveBlockers = ["standard questions", "rental questions", "does not wish to proceed"];
                          // const haltAutoSave = autoSaveBlockers.some(str => noteText.toLowerCase().includes(str));
  
                          let finalText = existingText ? existingText + "\n\n" + noteText : noteText;
                          finalText = finalText.replace(/ <br><font[^>]*>(.*?)<\/font>/gi, "");
  
                          setTextareaValue(el, finalText);
  
                          // if (haltAutoSave) return;
                          if (!autoSave) return;
  
                          if (!existingText) {
                              const saveButton = document.querySelector(saveButtonSelector);
                              if (saveButton) {
                                  setTimeout(() => saveButton.click(), 100);
                                  if (dispo) {
                                      // setDisposition(dispo);
                                  }
                                  if (nextAccount) {
                                      clickToNextContact();
                                  }
                                  if (finalText.toLowerCase().includes("contract sent to ")) {
                                      alert('Reminder: Add CMV to notes');
                                  }
                              }
                          }
                      }
  
                      const textarea = document.querySelector(textareaSelector);
                      if (textarea) {
                          handleNoteInsert(textarea, text);
                      } else {
                          const addNoteButton = document.getElementById("add-note-button");
                          if (addNoteButton) {
                              addNoteButton.click();
                              setTimeout(() => {
                                  const newTextarea = document.querySelector(textareaSelector);
                                  if (newTextarea) {
                                      handleNoteInsert(newTextarea, text);
                                  } else {
                                      cWarn("Textarea still not found after 250ms.");
                                  }
                              }, 250);
                          }
                      }
                  });
  
                  dropdown.appendChild(noteButtonItem);
              });
  
          } finally {
              // optional cleanup
          }
      }
  
      noteButton.addEventListener('click', async (e) => {
          e.stopPropagation();
          const isOpen = !dropdown.classList.contains('hidden');
          if (isOpen) {
              dropdown.classList.add('hidden');
          } else {
              renderNoteOptions();
              dropdown.classList.remove('hidden');
          }
      });
  
      dropdown.addEventListener('mouseenter', () => {
          dropdown.classList.remove('hidden');
      });
  
      noteButton.addEventListener('mouseleave', () => {
          setTimeout(() => {
              if (!dropdown.matches(':hover') && !noteButton.matches(':hover')) {
                  dropdown.classList.add('hidden');
              }
          }, 100);
      });
  
      voicemailBtn.parentNode.insertBefore(noteButton, voicemailBtn.nextSibling);
  }
  
function getFirebaseIdToken() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("firebaseLocalStorageDb");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("firebaseLocalStorage", "readonly");
      const store = tx.objectStore("firebaseLocalStorage");
      const all = store.getAll();
      all.onerror = () => reject(all.error);
      all.onsuccess = () => {
        const rows = all.result || [];
        const row = rows.find(r => /authUser/.test(r.fbase_key));
        if (!row) return reject(new Error("authUser not found in IndexedDB"));
        const val = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
        const token = val?.stsTokenManager?.accessToken;
        if (!token) return reject(new Error("accessToken missing"));
        resolve(token);
      };
    };
  });
}

async function loadMessages() {
  const idToken = await getFirebaseIdToken();

  const res = await fetch("https://services.leadconnectorhq.com/conversations/QivnC3LJ9gJdPSWbRS48/messages", {
    method: "GET",
    headers: {
      Accept: "application/json",
      "token-id": idToken,
      channel: "APP",
      source: "WEB_USER",
      version: "2021-04-15"
    },
    mode: "cors",
    credentials: "omit",
    cache: "no-store"
  });

  if (res.status === 304) return { messages: [], note: "Not modified" };
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} ${text}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text();
    throw new Error(`Expected JSON, got ${ct}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

async function extractContactData() {
  try {
    const data = await loadMessages();

    let list = Array.isArray(data?.messages?.messages) ? data.messages.messages : [];

    list = list.sort((a, b) => {
      const ta = new Date(a.createdAt || a.dateAdded || a.dateUpdated || 0).getTime();
      const tb = new Date(b.createdAt || b.dateAdded || b.dateUpdated || 0).getTime();
      return tb - ta;
    });

    const sms = { messages: [], inbound_messages: [], outbound_messages: [] };
    const calls = { messages: [], inbound_messages: [], outbound_messages: [] };
    const email = { messages: [], inbound_messages: [], outbound_messages: [] };
    const voicemail = { messages: [], inbound_messages: [], outbound_messages: [] };

    for (const m of list) {
      const isEmail = Object.prototype.hasOwnProperty.call(m, "latestOutboundLcEmailProvider");
      const isSms = !isEmail && Object.prototype.hasOwnProperty.call(m, "body");
      const bucket = isEmail ? email : isSms ? sms : calls;

      const dirRaw = m?.direction ?? m?.meta?.email?.direction ?? "";
      const dir = String(dirRaw).toLowerCase();

      bucket.messages.push(m);
      if (dir === "inbound") bucket.inbound_messages.push(m);
      else if (dir === "outbound") bucket.outbound_messages.push(m);
    }

    // Use inbound + outbound calls to find voicemails
    const allCallCandidates = [...calls.inbound_messages, ...calls.outbound_messages];
    for (const c of allCallCandidates) {
      const added = new Date(c.dateAdded || 0).getTime();
      const updated = new Date(c.dateUpdated || 0).getTime();
      const duration = (updated - added) / 1000;
      if (duration >= 20 && duration <= 80) {
        voicemail.messages.push(c);
        const dir = String(c?.direction ?? "").toLowerCase();
        if (dir === "inbound") voicemail.inbound_messages.push(c);
        else if (dir === "outbound") voicemail.outbound_messages.push(c);
      }
    }

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    function todaySubset(msgs) {
      let count = 0;
      const todayMsgs = [];
      for (const m of msgs) {
        const t = new Date(m.createdAt || m.dateAdded || m.dateUpdated || 0);
        if (t >= start && t < end) {
          count++;
          todayMsgs.push(m);
        }
      }
      return { count, messages: todayMsgs };
    }

    function buildBucket(bucket) {
      const inbound = {
        count: bucket.inbound_messages.length,
        messages: bucket.inbound_messages,
        today: todaySubset(bucket.inbound_messages)
      };
      const outbound = {
        count: bucket.outbound_messages.length,
        messages: bucket.outbound_messages,
        today: todaySubset(bucket.outbound_messages)
      };
      const total = {
        count: bucket.messages.length,
        messages: bucket.messages,
        today: todaySubset(bucket.messages)
      };
      return { inbound, outbound, total };
    }

    const result = {
      sms: buildBucket(sms),
      calls: buildBucket(calls),
      email: buildBucket(email),
      voicemail: buildBucket(voicemail)
    };

    return result;
  } catch (err) {
    console.error("extractContactData error:", err);
    return null;
  }
}
  
  function removePostDialModal() {
      if (!ENABLE_AUTOHIDE_DIAL_SUMMARY) return;
      const dialer = document.querySelector('.dialer');
  
      if (dialer) {
          const el = document.querySelector(".dialer-body");
  
          if (el) {
              const button = el.getElementsByTagName("button")[0];
              if (button && button.innerText.includes("Done")) {
                  button.click();
                  /// setDisposition("Move to Contacted", "");
                  // autoDispositionCall("Move to Contacted", "Contacted");
  
                  let sellerFirstName = ' '+document.querySelector('[name="contact.first_name"]').value;
                  if (sellerFirstName.toLowerCase() === "unknown") {
                      sellerFirstName = '';
                  }
                  const sellerAddress1El = document.querySelector('[name="contact.address1"]');
  
                  let sellerAddress1 = '';
  
                  if (sellerAddress1El) {
                      sellerAddress1 = document.querySelector('[name="contact.address1"]').value;
                  }
  
  
                  // setTextMessage(`Hi${sellerFirstName}. I'm interested in the property you're looking to sell at ${sellerAddress1}. Can you please tell me a bit more about it?\n${myFirstName}`);
              }
          }
  
      }
  }
  
  
  function cleanupSidebarAndWidgets() {
      if (!ENABLE_CLEANUP_SIDEBAR_WIDGETS) return;
  
      const sideBarEl = document.getElementById('sidebar-v2');
      if (!sideBarEl) return;
  
      // Array of target text values to remove
      const targetTexts = ['Sites', 'Summer of AI', 'Memberships', 'Mobile App', 'Support', 'Marketing'];
  
      // Remove spans with matching text content
      const spans = document.querySelectorAll('span');
      for (const span of spans) {
          if (targetTexts.includes(span.textContent.trim())) {
              span.parentNode.style.display = 'none';  // Hide the element
          }
      }
  
      // Hide element with specific ID if it's not already hidden: location-switcher-sidbar-v2
      const locationSwitcher = document.getElementById('location-switcher-sidbar-v2');
      if (locationSwitcher && locationSwitcher.style.display !== 'none') {
          locationSwitcher.style.display = 'none';  // Hide the element
      }
  
  
      // Remove element with specific ID: engagement-widget-container
      const engagementWidget = document.getElementById('engagement-widget-container');
      if (engagementWidget) {
          engagementWidget.remove();  // Hide the element
      }
  }
  
  
  // decrease height to make Send button visible without scrolling
  function shrinkCenterPanelHeight() {
      if (!ENABLE_SHRINK_SMS_HEIGHT) return;
  
      const panel = document.querySelector('.central-panel-messages');
      const activeTab = document.querySelector('.nav-link.active');
  
      if (panel && activeTab) {
          const tabText = activeTab.innerText.trim();
  
          if (panel.style.height !== 'unset') {
              panel.style.height = 'unset';
              panel.style.maxHeight = '48vh';
          }
  
          if (tabText === 'Email' && panel.style.maxHeight !== '38vh') {
              panel.style.maxHeight = '38vh';
          } else if (tabText === 'SMS' && panel.style.maxHeight !== '48vh') {
              panel.style.maxHeight = '48vh';
          }
      }
  
  
  
      const toolbar = document.querySelector("#toolbar-contact-buttons");
      const contactWrap = document.querySelector(".hl_contact-details-new--wrap");
  
      if (toolbar) toolbar.style.height = '4%';
      if (contactWrap) contactWrap.style.height = '96%';
  
      //  panel = document.querySelector(".hl_contact-details-left");
  
      //  if (panel && panel.style.maxHeight !== '93%') {
      //  panel.style.maxHeight = '93%';
      //  }
  
  }
  
  
  function autoDispositionCall(disposition, tagName) {
      if (!ENABLE_AUTO_DISPOSITION) return;
  
      if (disposition === '') return;
  
      // open tags check
      const noTag = tagExists(tagName);
  
      if (noTag) return;
  
      // set new disposition
      const select = document.querySelector('select[name="contact.call_disposal_automations"]');
      let newValue = '';
  
      setDisposition(disposition, "");
  }
  
  
  function setTextMessage(msg) {
      if (!ENABLE_AUTO_SMS_POST_CALL) return;
  
      const el = document.getElementById("text-message");
      if (el) {
          el.value = msg;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
      }
  }
  
  
  function showDateInTimestamps() {
      if (!ENABLE_SHOW_TIMESTAMPS) return;
  
      if (isOnContactPage(location.href) || isOnConversationsPage(location.href)) {
          // Find all elements with the class 'flex time-date'
          const flexElements = document.querySelectorAll('.flex.time-date');
  
          flexElements.forEach(element => {
              // Find the span inside each element
              const span = element.querySelector('span');
  
              // Ensure the span exists and check if its innerText doesn't include the title
              const t = span?.title || '';
              if (span && t && !span.innerText.includes(t)) {
                  span.innerText = t;
              }
          });
      }
  }
  
  
  function openConversationSameWindow() {
      if (!isOnConversationsPage(location.href)) return;
      const div = document.querySelector('div.rounded-full.text-primary-700.p-1.absolute');
  
      if (div) {
          const anchor = div.closest('a');
          if (anchor && anchor.href.includes('/contacts/detail/') && anchor.target === '_blank') {
              anchor.removeAttribute('target');
          }
      }
  }
  
  async function checkUrlChange() {
      if (!ENABLE_MONITOR_URL_CHANGES) return;
  
      const currentUrl = location.href;
      const currentBaseUrl = getBaseContactUrl(currentUrl);
  
      if (currentBaseUrl !== lastBaseUrl) {
          cLog(`URL changed from ${lastBaseUrl} to ${currentBaseUrl}`);
          lastBaseUrl = currentBaseUrl;
  
          const onContactPage = isOnContactPage(currentBaseUrl);
          storedAddress = '';
          initialized = false;
          wasOnContactPage = false;
          hasClickedNotesTab = false;
          bannerDismissed = false;
          myStatsAdded = false;
          jsonData = [];
          noteBlock = null;
          notesScrollInitialized = false;
          window.myStatsAdded = false;
          iterationCount = 0;
          hasRunExtractNoteData = false;
  
          removeIfExists("tb_voicemail_menu");
          removeIfExists("tb_addnote_menu");
          removeIfExists("tb_email_menu");
          removeIfExists("tb_textmessage_menu");
          removeIfExists("tb_script_menu");
          removeIfExists("notification_banner-top_bar");
          removeIfExists("notification_banner-top_bar_conversations");
  
          removeIfExists("myStatsWidget");
  
          const userInfo = await getUserData();
  
          if (!onContactPage && wasOnContactPage && ENABLE_PAGE_LEAVE_CLEAR) {
              return false;
          }
  
          if (onContactPage && !wasOnContactPage) wasOnContactPage = true;
  
          return true;
      }
  
      return false;
  }
  
  
  function cleanupDetachedDOMNodes() {
      return;
      const sidebar = document.getElementById('sidebar-v2');
      if (!sidebar) return;
  
      const detached = new Set();
      const visited = new WeakSet();
      const knownGlobals = [window, document];
  
      function walk(obj) {
          const stack = [obj];
          while (stack.length) {
              const current = stack.pop();
              if (!current || typeof current !== 'object' || visited.has(current)) continue;
              visited.add(current);
  
              try {
                  if (current instanceof HTMLElement && !document.body.contains(current)) {
                      detached.add(current);
                  }
  
                  for (const key in current) {
                      if (Object.prototype.hasOwnProperty.call(current, key)) {
                          stack.push(current[key]);
                      }
                  }
              } catch (e) {
                  // Ignore access errors (e.g., cross-origin)
              }
          }
      }
  
      knownGlobals.forEach(walk);
  
      if (detached.size === 0) {
          console.log('No detached DOM elements found.');
          return;
      }
  
      console.log(`Found ${detached.size} detached elements. Attempting cleanup.`);
  
      detached.forEach(el => {
          try {
              el.replaceWith(el.cloneNode(false)); // Remove listeners and child refs
          } catch (e) {}
  
          for (const key in window) {
              if (window[key] === el) {
                  console.log(`Nullifying window["${key}"]`);
                  window[key] = null;
              }
          }
      });
  
      console.log('Detached elements cleaned (where possible). Garbage collection may take effect soon.');
  };
  
  
  
  function updateDocuSealIframeSrc() {
      const iframe = document.querySelector('iframe');
      if (iframe && iframe.src === 'https://monopolymoney.ca/docuseal-display-table') {
          iframe.src = 'https://monopolymoney.ca/docuseal-display-new-table';
      }
  }
  
  async function updateContactsToCustomURLs() {
      if (!ENABLE_SIDEBAR_URL_CHANGE) return;
  
      const sidebar = document.getElementById('sidebar-v2');
      if (sidebar) {
          const config = window.scriptConfig || {};
          const contactsHref = config.contactsHref;
          const dashboardHref = config.dashboardHref;
  
          const contactsLink = document.querySelector('a#sb_contacts');
          const dashboardLink = document.querySelector('a#sb_dashboard');
  
          if (contactsLink && contactsHref && contactsLink.getAttribute('href') !== contactsHref) {
              const clonedContactsLink = contactsLink.cloneNode(true);
              clonedContactsLink.href = contactsHref;
              contactsLink.replaceWith(clonedContactsLink);
          }
  
          if (dashboardLink && dashboardHref && dashboardLink.getAttribute('href') !== dashboardHref) {
              const clonedDashboardLink = dashboardLink.cloneNode(true);
              clonedDashboardLink.href = dashboardHref;
              dashboardLink.replaceWith(clonedDashboardLink);
          }
      }
  }
  
  
  function updateBannerSlideElements() {
      // Inject CSS once
      if (!document.getElementById('dynamic-banner-style')) {
          const style = document.createElement('style');
          style.id = 'dynamic-banner-style';
          style.textContent = `
              .banner-adjust .hl_topbar-tabs > * {
                  padding-top: 40px !important;
              }
  
              .banner-adjust header.hl_header {
                  padding-top: 40px !important;
              }
  
              .banner-adjust .hl_header--controls {
                  padding-top: 100px !important;
              }
  
              .banner-adjust .power-dialer-modal {
                  margin-top: 100px !important;
              }
          `;
          document.head.appendChild(style);
      }
  
      const bannerExists = !!document.getElementById('notification_banner-top_bar') || !!document.getElementById('notification_banner-top_bar_conversations');
  
      if (bannerExists) {
          // Add to a central wrapper or body if needed
          document.body.classList.add('banner-adjust');
      } else {
          // Remove the class from all elements that have it
          document.querySelectorAll('.banner-adjust').forEach(el => {
              el.classList.remove('banner-adjust');
          });
      }
  }
  
  function hideWhatsAppTab() {
      const tab = document.querySelector('#whatsapp-tab');
      if (tab && tab.style.display !== 'none') {
          tab.style.display = 'none';
      }
  }
  
  function notesScrollTo() {
      const container = document.getElementById("notes-list-container-contact");
      if (!container) return;
  
      // Stop if this logic already ran — dataset is persistent even across script reloads
      if (container.dataset.notesScrollInitialized === "true") return;
      container.dataset.notesScrollInitialized = "true";
  
      const scrollAndWatch = () => {
          if (container.dataset.scrolledToTop === "true") return;
  
          const content = container.innerText.toLowerCase();
  
          const isCallSummary = content.includes("****call summary");
          const hasAddressAndName = content.includes("address") && content.includes("name") && content.includes("email");
          const hasFirstAndLastName = content.includes("first name") && content.includes("last name");
          const hasSourceAndName = content.includes("source") && content.includes("name");
          const hasFirstNameSnakeCase = content.includes("first_name");
  
          const matches = (hasAddressAndName || hasFirstAndLastName || hasSourceAndName || hasFirstNameSnakeCase) && !isCallSummary;
  
          if (matches) {
              container.scrollTop = 0;
              container.dataset.scrolledToTop = "true";
              console.log("notesScrollTo: match found, scrolling to top");
              return;
          }
  
          // Still waiting for content — keep checking
          console.log("notesScrollTo: scrolling");
  
          // Scroll down until the content is updated
          container.scrollTop = container.scrollHeight;
  
          // Check if we are at the bottom
          const atBottom = container.scrollHeight === container.scrollTop + container.clientHeight;
  
          if (!atBottom) {
              // Wait for the next frame to check again
              requestAnimationFrame(scrollAndWatch);
          } else {
              // If we reach the bottom and no match, stop the process
              console.log("notesScrollTo: reached bottom, no match found.");
          }
      };
  
      requestAnimationFrame(scrollAndWatch);
  }
  
  
  
  
  function autoResizeNotes() {
      const selectors = ['.n-input__textarea-el', '.n-input-wrapper'];
  
      for (const selector of selectors) {
          document.querySelectorAll(selector).forEach(el => {
              el.style.height = 'auto';
              el.style.overflow = 'hidden';
  
              const computed = window.getComputedStyle(el);
              const padding = ['borderTopWidth', 'borderBottomWidth', 'paddingTop', 'paddingBottom']
              .map(prop => parseFloat(computed[prop]) || 0)
              .reduce((sum, val) => sum + val, 0);
  
              el.style.height = (el.scrollHeight + padding) + 'px';
          });
      }
  }
  
  function monMonIputUpdate() {
      const element = document.querySelector('div[id^="menu-contact-"]');
      if (!element) return;
  }
  
  function moveCallBtn() {
      // console.log("[moveCallBtn] init");
      
      const inContactDetail = location.href.includes("contacts/detail/");
      const callSellerBtn   = document.querySelector('.message-header-actions.contact-detail-actions');
      const nextSeller      = document.querySelector('.d-inline-block.text-xs.text-gray-900');
      const powerDialer     = document.querySelector('#template-power-dialer');
      const powerDialerModal= document.querySelector('.power-dialer-modal');
      const activeCall      = document.querySelector('.contact-details.flex.items-center.justify-center.gap-2');
  
      if (!inContactDetail) {
          callSellerBtn?.remove();
          nextSeller?.remove();
          return;
      }
  
      if (powerDialer && nextSeller && !powerDialer.parentNode.contains(nextSeller)) {
          powerDialer.parentNode.insertBefore(nextSeller, powerDialer);
      }
  
      if (powerDialer && callSellerBtn && !powerDialer.parentNode.contains(callSellerBtn)) {
          powerDialer.parentNode.insertBefore(callSellerBtn, powerDialer);
      }
  
      const modalVisible = powerDialerModal && window.getComputedStyle(powerDialerModal).display !== 'none';
      const callOngoing  = !!activeCall;
  
      if (callSellerBtn) {
          callSellerBtn.style.setProperty(
              'display',
              (callOngoing || modalVisible) ? 'none' : '',
              'important'
          );
      }
  }
  
  function avatarHref() {
    if (!location.href.includes("/contacts/smart_list/")) return;
  
    document.querySelectorAll('#hl_smartlists-main .avatar_img').forEach(item => {    
      if (item.dataset.listenerAttached) return; // already bound
      item.dataset.listenerAttached = 'true';
    
      item.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
    
        const myID = location.pathname.match(/(?:^|\/)location\/([^/]+)\/contacts(?:\/|$)/)?.[1] || null;
        
        // Get the contact row id robustly
        const id =
          item.closest('tr[id]')?.id ||     // preferred: table row with id
          item.closest('[id]')?.id ||       // fallback: any ancestor with id
          null;
    
        if (!myID || !id) {
          console.warn('Missing myID or contact row id.');
          return;
        }
    
        window.open(
          `${location.origin}/v2/location/${myID}/contacts/detail/${id}?view=note`,
          '_blank'
        );
      });
    });
  }
  
  // Helper to check if time is within allowed window
  function isWithinCallHours(timeStr) {
    if (!timeStr || timeStr === "Unknown time") return false;
    const [time, meridian] = timeStr.split(" ");
    let [hour, minute] = time.split(":").map(Number);
    if (meridian === "PM" && hour !== 12) hour += 12;
    if (meridian === "AM" && hour === 12) hour = 0;
    const start = typeof CALL_START_HOUR === 'number' ? CALL_START_HOUR : 8;
    const end   = typeof CALL_END_HOUR   === 'number' ? CALL_END_HOUR   : 20;
    return hour >= start && hour < end;
  
  }
  
  function populateCallQueue() {
    if (!location.href.includes("/contacts/smart_list/")) return;
    const activeNavIcon = document.querySelector(".active-navigation-icon");
    const navText = activeNavIcon?.parentNode?.innerText?.trim() || "";
    if (navText !== "Queue") return;
  
    const totalSpan = document.querySelector('.flex-right-portion .barsection span');
    let totalRecords = null;
    
    if (totalSpan) {
      const match = totalSpan.textContent.replace(/\s+/g, ' ').match(/Total\s+(\d+)\s+records/i);
      if (match) totalRecords = parseInt(match[1], 10);
    }
    
    // If < 25 records, skip pagination change
    if (typeof totalRecords === 'number' && totalRecords < 25) {
      // return;
    }
  
    // Current page size text
    let pageSize = parseInt(
      document.querySelector("#hl_smartlists-main a#dropdownMenuButton")
        ?.textContent.replace(/\D+/g, "") || "0",
      10
    );
    if (!Number.isFinite(pageSize)) pageSize = 0;
  
    // If page size is not 100, change it to 100
    if (totalRecords >= 25 && pageSize !== 100) {
      const dropdownBtn = document.querySelector("#hl_smartlists-main a#dropdownMenuButton");
      if (dropdownBtn) {
        dropdownBtn.click(); // open the dropdown
        const option100El = Array.from(document.querySelectorAll("#hl_smartlists-main .dropdown-menu .dropdown-item span.text.align-right"))
          .find(el => el.textContent.trim() === "100");
        if (option100El) {
          option100El.click(); // select 100
        }
      }
      return; // stop here so the function reruns with the correct size
    }
    
    // Target the 2nd voicemail container
    const containers = document.querySelectorAll(".voicemail-container");
    const container = containers[1];
    if (!container) return;
  
    // Legacy gate
    if (container.dataset.queuePopulated === "1") {
      delete container.dataset.queuePopulated;
    }
  
    // Config
    const { createClientList } = window.scriptConfig || {};
    if (!createClientList) return;
    const myID = location.pathname.match(/(?:^|\/)location\/([^/]+)\/contacts(?:\/|$)/)?.[1] || null;
  
    // Use location.origin as requested
    const BASE_URL = `${location.origin}/v2/location/${myID}/contacts/detail/`;
    
    // Collect current rows
    const rows = document.querySelectorAll("tr[id]");
    if (!rows.length) return;
  
    // Build data from table
    const data = Array.from(rows).map((row) => {
      const tds = row.querySelectorAll("td");
  
      // Try to find an address if your table has one (robust fallbacks)
      const addrEl =
        row.querySelector('[data-column="Address"], .address, .contact-address') ||
        tds[8] || tds[9] || null;
      const address = (addrEl?.innerText || addrEl?.textContent || "").replace(/\s+/g, " ").trim();
  
      // Phone raw from table
      const phoneRaw = tds[3]?.querySelector("span")?.textContent.trim() || "";
  
      // Replace leading "+1" (with optional space) in the ARRAY (display)
      const phoneNoPlus1 = phoneRaw.replace(/^\+1\s*/i, "");
  
      return {
        id: row.id,
        name: tds[2]?.querySelector("a")?.textContent.trim() || "",
        href: `${BASE_URL}${row.id}?view=note`,
        phoneDisplay: phoneNoPlus1,
        phoneRaw, // keep original just in case
        address
      };
    });
  
    // Signature
    const rowIds = Array.from(rows, (r) => r.id).join("|");
    const signature = `${pageSize}:${rows.length}:${rowIds}`;
    if (container.dataset.queueSig === signature) return;
  
    // Helpers
    const initialsOf = (nameOrPhone) => {
      const name = nameOrPhone || "";
      const parts = name.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) return "UC";
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    };
  
    // Stable RGB for avatar
    const rgbFromId = (id) => {
      let h = 0;
      const s = String(id || "");
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      const r = 117 + (h % 73);
      const g = 117 + ((h >> 3) % 73);
      const b = 117 + ((h >> 6) % 73);
      return `rgb(${r}, ${g}, ${b})`;
    };
  
    // For typing: digits only, drop leading 1 if it's 11 digits
    const phoneForTyping = (s) => {
      const digits = String(s || "").replace(/\D+/g, "");
      return digits.replace(/^1(?=\d{10}$)/, "");
    };
  
    // Extract NANP area code from arbitrary string (phone/address)
    const extractAreaCode = (raw) => {
      if (!raw) return "";
      const digits = String(raw).replace(/\D+/g, "");
      if (!digits) return "";
      // if it looks like 11 digits with leading 1
      if (digits.length >= 11 && digits.startsWith("1")) return digits.slice(1, 4);
      return digits.slice(0, 3);
    };
  
    // Build items with zone/time info for phone and address
    const items = data.map((d) => {
      const initials = initialsOf(d.name || d.phoneDisplay || "Unknown");
      const bg = rgbFromId(d.id || d.phoneDisplay || d.name);
  
      // Phone zone
      const phoneArea = extractAreaCode(d.phoneDisplay || d.phoneRaw);
      const [phLoc, phTz, phTime] = phoneArea ? getAreaCodeInfo(phoneArea) : ["Unknown", "Unknown", "Unknown time"];
  
      // Address zone (only if address present and we can find 3 digits to treat as area code)
      let addrInfo = null;
      if (d.address) {
        const addrArea = extractAreaCode(d.address);
        if (addrArea) {
          const [aloc, atz, atime] = getAreaCodeInfo(addrArea);
          addrInfo = `${aloc} (${atz}) · ${atime}`;
        }
      }
  
      return {
        id: d.id,
        name: d.name || d.phoneDisplay || "Unknown Contact",
        href: d.href,
        initials,
        bg,
        phoneDisplay: d.phoneDisplay || "",
        phoneToType: phoneForTyping(d.phoneDisplay || d.phoneRaw),
        phoneLoc: phLoc,
        phoneTz: phTz,
        phoneTime: phTime,
        address: d.address
      };
    });
  
    if (items.length === 0) return;
  
    console.log('items', items);
    
    const html = `
      <div class="relative overflow-y-auto pt-2">
        <div class="flex flex-col px-4">
          ${items.map(item => `
            <div class="flex flex-col">
              <!-- ROW -->
              <div class="contact-row flex items-start gap-3 py-2" style="height:auto;min-height:unset;" data-href="${item.href}">
                <!-- avatar -->
                <div class="h-10 w-10 flex items-center justify-center rounded-full shrink-0"
                     style="background-color:${item.bg};">
                  <span class="text-base leading-none text-white">${item.initials}</span>
                </div>
    
                <!-- content -->
                <div class="flex-1 min-w-0">
                  <p class="m-0 text-left text-sm font-semibold leading-5 text-gray-600 cursor-pointer contact-name"
                     data-href="${item.href}">
                    ${item.name}
                  </p>
    
                  ${item.phoneDisplay ? `
                    <p class="m-0 mt-0.5 text-left text-sm leading-5">${item.phoneDisplay}</p>
                  ` : ""}
    
                  ${(item.phoneLoc !== "Unknown" || item.phoneTz !== "Unknown") ? `
                    <p class="m-0 mt-0.5 text-[11px] leading-4 text-gray-500">
                      ${item.phoneLoc} (${item.phoneTz}) · ${item.phoneTime}
                    </p>
                  ` : ""}
    
                  ${item.address ? `
                    <p class="m-0 mt-0.5 text-[12px] leading-5 text-gray-600">
                      ${item.address}
                    </p>
                  ` : ""}
                </div>
    
                <!-- dial icon -->
                <div class="shrink-0 p-2">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                       stroke-width="2" stroke="currentColor"
                       class="contact-dial h-5 w-5 ${isWithinCallHours(item.phoneTime) ? 'cursor-pointer text-gray-600' : 'text-gray-300 opacity-50'}"
                       data-phone="${item.phoneToType}"
                       ${isWithinCallHours(item.phoneTime) ? '' : 'style="pointer-events:none;"'}>
                    <path stroke-linecap="round" stroke-linejoin="round"
                      d="M8.38 8.853a14.603 14.603 0 002.847 4.01 14.603 14.603 0 004.01 2.847c.124.06.187.09.265.112.28.082.625.023.862-.147.067-.048.124-.105.239-.219.35-.35.524-.524.7-.639a2 2 0 012.18 0c.176.115.35.29.7.64l.195.194c.532.531.797.797.942 1.082a2 2 0 010 1.806c-.145.285-.41.551-.942 1.082l-.157.158c-.53.53-.795.794-1.155.997-.4.224-1.02.386-1.478.384-.413-.001-.695-.081-1.26-.241a19.038 19.038 0 01-8.283-4.874A19.039 19.039 0 013.17 7.761c-.16-.564-.24-.846-.241-1.26a3.377 3.377 0 01.384-1.477c.202-.36.467-.625.997-1.155l.157-.158c.532-.53.798-.797 1.083-.941a2 2 0 011.805 0c.286.144.551.41 1.083.942l.195.194c.35.35.524.525.638.7a2 2 0 010 2.18c-.114.177-.289.352-.638.701-.115.114-.172.172-.22.238-.17.238-.228.582-.147.862.023.08.053.142.113.266z"></path>
                  </svg>
                </div>
              </div>
    
              <!-- divider -->
              <div class="h-px bg-gray-200"></div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  
    // Inject into the voicemail container
    container.innerHTML = html;
    container.dataset.queueSig = signature;
  
    // Make modal visible if it was hidden
    const modal = document.querySelector(".power-dialer-modal.flex");
    if (modal && modal.style.display === "none") modal.style.display = "";
  
    // Name -> open in new tab
    container.addEventListener("click", (e) => {
      // Ignore clicks on the telephone icon
      if (e.target.closest(".contact-dial")) return;
      
      const rowEl = e.target.closest(".contact-row");
      if (!rowEl) return;
      
      e.preventDefault();
      const href = rowEl.getAttribute("data-href");
      if (href) window.open(href, "_blank");
    });
  
    // Phone icon -> hide list, show keypad, type number (no call)
    container.addEventListener("click", async (e) => {
      const dialEl = e.target.closest(".contact-dial");
      if (!dialEl) return;
      e.preventDefault();
  
      // hide this voicemail container
      // container.style.display = "none";
      // container.style.backgroundColor = "lightgreen";
  
      // Highlight the row in lightgreen and persist it
      const contactRow = dialEl.closest(".contact-row");
      if (contactRow) {
        contactRow.style.backgroundColor = "lightgreen";
      }
  
      // unhide keypad
      const keypad = document.querySelector(".keypad");
      // if (keypad) keypad.style.display = "";
  
      const phone = (dialEl.getAttribute("data-phone") || "").trim();
      if (!phone) return;
  
      const dialerInput = document.querySelector("input#dialer-input"); // update if your selector differs
      if (!(dialerInput instanceof HTMLInputElement)) return;
  
      setInputValueSecurely(dialerInput, "");
      await simulateSecureTyping(dialerInput, phone);
  
      const dialBtn = document.querySelector(".dial-item.dial-btn.dial-btn-enabled");
      if (dialBtn) {
        await dialBtn.click();
          
        // keypad.style.display = "none";
        
        // Finds the first element with class "navigation-container" containing "Queue" and clicks it
        document.querySelectorAll('.navigation-container').forEach(el => {
          if (el.innerText.includes('Queue')) {
            el.click();
          }
        });
      }
    });
  }
  
  function monMonFreeFloat() {
      return;
      const element = document.querySelector('div[id^="menu-contact-"]');
  
      // Remove positioning styles and make it float
      element.style.position = 'fixed'; // or 'absolute' if you want it to scroll with the page
      element.style.left = '100px'; // starting position
      element.style.top = '100px';
      element.style.right = '';
      element.style.margin = '';
      element.style.zIndex = '9999'; // ensure it stays on top
  
      // Optional: make it draggable
      let isDragging = false;
      let offsetX = 0;
      let offsetY = 0;
  
      element.style.cursor = 'move';
  
      element.addEventListener('mousedown', (e) => {
          isDragging = true;
          offsetX = e.clientX - element.getBoundingClientRect().left;
          offsetY = e.clientY - element.getBoundingClientRect().top;
          e.preventDefault();
      });
  
      document.addEventListener('mousemove', (e) => {
          if (isDragging) {
              element.style.left = `${e.clientX - offsetX}px`;
              element.style.top = `${e.clientY - offsetY}px`;
          }
      });
  
      document.addEventListener('mouseup', () => {
          isDragging = false;
      });
  
      console.log('Element is now free-floating and draggable.');
  }
  
  
  function autoDispositionOfferMade() {
      const successAlert = document.querySelector('.alert.alert-success');
  
      if (successAlert && successAlert.textContent.trim() === "Data added and Emails sent successfully.") {
          setDisposition("Move to Initial Offer Made");
      }
  }
  
  function moveFieldByLabel(labelText) {
      const target = document.querySelector('#note-form-contact');
      if (!target) return;
  
      // Normalize by trimming only (keep case intact)
      const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  
      // Inject styles for right alignment (only once)
      if (!document.getElementById('mirrored-fields-style')) {
          const style = document.createElement('style');
          style.id = 'mirrored-fields-style';
          style.textContent = `
              #moved-fields-container {
                  display: flex;
                  flex-direction: column;
                  align-items: flex-end;
              }
              .mirrored-field {
                  display: flex;
                  flex-direction: column;
                  text-align: right;
                  margin-bottom: 8px;
              }
              .mirrored-field label {
                  margin-bottom: 4px;
              }
          `;
          document.head.appendChild(style);
      }
  
      // 1) Get or create the container right after #note-form-contact
      let container = document.getElementById('moved-fields-container');
      if (!container) {
          container = document.createElement('div');
          container.id = 'moved-fields-container';
          if (target && target.parentNode) {
              target.insertAdjacentElement('afterend', container);
          }
      }
  
      // 2) Find the original control by exact match
      const wanted = norm(labelText);
      let fieldWrapper = null;
      let original = null;
  
      // a) Try [data-label]
      for (const el of document.querySelectorAll('[data-label]')) {
          const dl = norm(el.getAttribute('data-label'));
          if (dl === wanted) {
              const ctrl = el.querySelector('input, textarea, select');
              if (ctrl) { fieldWrapper = el; original = ctrl; break; }
          }
      }
  
      // b) Try <label> elements
      if (!original) {
          for (const lab of document.querySelectorAll('label')) {
              const txt = norm(lab.textContent);
              if (txt === wanted) {
                  if (lab.htmlFor) {
                      original = document.getElementById(lab.htmlFor);
                  }
                  if (!original) {
                      original = lab.querySelector('input, textarea, select') ||
                          lab.parentElement?.querySelector('input, textarea, select');
                  }
                  if (original) { fieldWrapper = original.closest('[data-label]') || lab; break; }
              }
          }
      }
  
      // c) Try aria-label
      if (!original) {
          for (const ctrl of document.querySelectorAll('input[aria-label], textarea[aria-label], select[aria-label]')) {
              const al = norm(ctrl.getAttribute('aria-label'));
              if (al === wanted) {
                  original = ctrl;
                  fieldWrapper = original.closest('[data-label]') || original.parentElement;
                  break;
              }
          }
      }
  
      // If not found, bail quietly
      if (!original || !fieldWrapper) return;
  
      // 3) Only mirror once
      if (original.dataset.mirrored === 'true') return;
      original.dataset.mirrored = 'true';
  
      // 4) Build a visible block inside the container
      const mirrorBlock = document.createElement('div');
      mirrorBlock.className = 'mirrored-field';
      mirrorBlock.setAttribute('data-mirror-for', original.name || original.id || wanted);
  
      const labelEl = document.createElement('label');
      const displayLabel = fieldWrapper.getAttribute('data-label')?.trim() || labelText;
      labelEl.textContent = displayLabel;
  
      // Create a mirror control matching the original type
      let mirror;
      if (original.tagName === 'SELECT') {
          mirror = document.createElement('select');
          for (const opt of original.options) {
              const o = document.createElement('option');
              o.value = opt.value;
              o.text = opt.text;
              o.disabled = opt.disabled;
              o.hidden = opt.hidden;
              mirror.appendChild(o);
          }
          mirror.value = original.value;
  
          // Mirror -> original
          mirror.addEventListener('change', () => {
              if (original.value !== mirror.value) {
                  original.value = mirror.value;
                  original.dispatchEvent(new Event('input', { bubbles: true }));
                  original.dispatchEvent(new Event('change', { bubbles: true }));
              }
          });
  
          // Original -> mirror
          original.addEventListener('change', () => {
              if (mirror.value !== original.value) mirror.value = original.value;
          });
      } else {
          // input or textarea
          mirror = document.createElement('input');
          mirror.type = (original.type && original.type !== 'hidden') ? original.type : 'text';
          mirror.value = original.value || '';
  
          // Mirror -> original
          mirror.addEventListener('input', () => {
              if (original.value !== mirror.value) {
                  original.value = mirror.value;
                  original.dispatchEvent(new Event('input', { bubbles: true }));
                  original.dispatchEvent(new Event('change', { bubbles: true }));
              }
          });
  
          // Original -> mirror
          original.addEventListener('input', () => {
              if (mirror.value !== original.value) mirror.value = original.value;
          });
      }
  
      mirror.setAttribute('placeholder', displayLabel);
  
      // Add label and input to the block and append to container
      mirrorBlock.appendChild(labelEl);
      mirrorBlock.appendChild(mirror);
      container.appendChild(mirrorBlock);
  }
  
  // SPA Cleanup – paste into a DevTools Snippet
  // Define a global function you can call from console: spaCleanup({ dryRun: false })
  function spaCleanup(opts = {}) {
      const cfg = Object.assign({
          appRootSel: '#root, #app',
          dryRun: true,          // true = log only, false = actually clean
          clearTimers: false,    // true = clears ALL timeouts/intervals (can break the page)
          nukeIframes: true,
          nukeOverlays: true,
          cancelAnimations: true,
          revokeBlobUrls: true,
          releaseWebGL: true,
          verbose: true
      }, opts);
  
      const log = (...a) => cfg.verbose && console.log('[spaCleanup]', ...a);
      const act = (fn) => cfg.dryRun ? void 0 : fn();
  
      const roots = Array.from(document.querySelectorAll(cfg.appRootSel));
      const isInsideRoot = (el) => roots.some(r => el === r || r.contains(el));
  
      const removed = { iframes: 0, overlays: 0, blobs: 0, canvases: 0, anims: 0, timers: 0 };
  
      // 1) Cancel Web Animations
      if (cfg.cancelAnimations && document.getAnimations) {
          const anims = document.getAnimations();
          removed.anims = anims.length;
          anims.forEach(a => act(() => a.cancel()));
          log(`Animations ${cfg.dryRun ? '(would cancel)' : 'canceled'}:`, anims.length);
      }
  
      // 2) Revoke blob: URLs
      if (cfg.revokeBlobUrls) {
          const attrs = ['src', 'href', 'poster'];
          const nodes = Array.from(document.querySelectorAll('*')).filter(el =>
                                                                          attrs.some(attr => {
              const v = el.getAttribute?.(attr);
              return v && v.startsWith('blob:');
          })
                                                                         );
          nodes.forEach(el => {
              attrs.forEach(attr => {
                  const url = el.getAttribute?.(attr);
                  if (url && url.startsWith('blob:')) {
                      log(`Blob URL ${cfg.dryRun ? '(would revoke)' : 'revoked'}:`, url, 'on', el);
                      act(() => {
                          try { URL.revokeObjectURL(url); } catch {}
                          try { el.removeAttribute(attr); } catch {}
                      });
                      removed.blobs++;
                  }
              });
          });
      }
  
      // 3) Remove overlays outside root
      if (cfg.nukeOverlays) {
          const candidates = Array.from(document.body.querySelectorAll('div,section,aside'))
          .filter(el => !isInsideRoot(el))
          .filter(el => {
              const cs = getComputedStyle(el);
              const fixed = cs.position === 'fixed' || cs.position === 'sticky';
              const covers =
                    parseInt(cs.zIndex || '0', 10) >= 1000 &&
                    (parseInt(cs.width) >= window.innerWidth * 0.9) &&
                    (parseInt(cs.height) >= window.innerHeight * 0.9);
              const hint = /\b(intercom|beacon|tawk|crisp|hubspot|drift|widget|tour|guide|overlay|modal)\b/i.test(
                  el.className + ' ' + el.id
              );
              return fixed && (covers || hint);
          });
  
          candidates.forEach(el => {
              log(`${cfg.dryRun ? 'Would remove overlay' : 'Removed overlay'}:`, el);
              act(() => el.remove());
              removed.overlays++;
          });
      }
  
      // 4) Remove iframes outside root
      if (cfg.nukeIframes) {
          const iframes = Array.from(document.querySelectorAll('iframe'))
          .filter(el => !isInsideRoot(el));
          iframes.forEach(f => {
              log(`${cfg.dryRun ? 'Would remove iframe' : 'Removed iframe'}:`, f.src || f);
              act(() => {
                  try { f.src = 'about:blank'; } catch {}
                  f.remove();
              });
              removed.iframes++;
          });
      }
  
      // 5) Release WebGL/canvas contexts outside root
      if (cfg.releaseWebGL) {
          const canvases = Array.from(document.querySelectorAll('canvas'))
          .filter(el => !isInsideRoot(el));
          canvases.forEach(c => {
              const lose = ctx => {
                  if (!ctx) return false;
                  const ext = ctx.getExtension && ctx.getExtension('WEBGL_lose_context');
                  if (ext && ext.loseContext) { ext.loseContext(); return true; }
                  return false;
              };
              let released = false;
              try { released = lose(c.getContext('webgl2')) || lose(c.getContext('webgl')); } catch {}
              if (released) {
                  log(`${cfg.dryRun ? 'Would release WebGL + remove canvas' : 'Released WebGL + removed canvas'}`, c);
                  act(() => { c.width = 0; c.height = 0; c.remove(); });
                  removed.canvases++;
              }
          });
      }
  
      // 6) Optional: clear timers
      if (cfg.clearTimers) {
          const maxId = setTimeout(() => {}, 0);
          for (let i = 0; i <= maxId; i++) {
              act(() => { clearTimeout(i); clearInterval(i); });
          }
          removed.timers = maxId + 1;
          log(`${cfg.dryRun ? 'Would clear' : 'Cleared'} timers up to id`, maxId);
      }
  
      console.table(removed);
      if (cfg.dryRun) {
          console.warn('spaCleanup ran in dryRun mode. Re-run with { dryRun: false } to apply.');
      }
  }
  
  function attachPhoneDialHandlers() {
    if (!location.href.includes("/contacts/smart_list/")) return;
    
    function blockRowNav(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  
    document.querySelectorAll('td[data-title="Phone"]').forEach((phoneCell) => {
      // If already attached, just refresh the phone number, badge, and icon then exit
      if (phoneCell.dataset.callListenerAttached === "1") {
        const freshSpan = phoneCell.querySelector("span");
        const freshPhone = (freshSpan?.textContent || "").replace(/\D/g, "").trim();
        phoneCell.dataset.callPhone = freshPhone || "";
  
        if (freshPhone) {
          const area = getAreaFromPhone(freshPhone);
          const [loc, tzLabel, localTime, localDate] = getAreaCodeInfoWithDate(area);
          const unknownTz = !tzLabel || tzLabel === "Unknown" || !localDate;
          const callableNow = !unknownTz && isCallableByPolicy(localTime, localDate);
  
          upsertTimeBadge(phoneCell, tzLabel, localTime, callableNow, unknownTz);
  
          phoneCell.dataset.calleeTzLabel = tzLabel || "";
          phoneCell.dataset.calleeLocalTime = localTime || "Unknown time";
          phoneCell.dataset.calleeUnknownTz = String(unknownTz);
          phoneCell.dataset.calleeCallable = String(callableNow);
  
          const faIconExisting = phoneCell.querySelector(".fa.fa-phone");
          if (faIconExisting) {
            faIconExisting.style.color = callableNow ? CALL_UI.okColor : CALL_UI.blockColor;
            faIconExisting.title = callableNow
              ? "Within call window"
              : (unknownTz ? "Timezone unknown" : "Outside call window");
          }
        }
        return;
      }
  
      const phoneSpan = phoneCell.querySelector("span");
      let phone = (phoneSpan?.textContent || "").trim();
  
      if (phoneSpan) phoneSpan.style.display = "inline";
      phoneCell.style.whiteSpace = "nowrap";
      
      const dialerInput = document.querySelector("input#dialer-input");
      if (!(dialerInput instanceof HTMLInputElement)) return;
  
      phone = phone.replace(/\D/g, "");
      if (!phone) return;
  
      phoneCell.dataset.callPhone = phone;
  
      // Compute + badge on first attach
      const area = getAreaFromPhone(phone);
      const [loc, tzLabel, localTime, localDate] = getAreaCodeInfoWithDate(area);
      const unknownTz = !tzLabel || tzLabel === "Unknown" || !localDate;
      const callableNow = !unknownTz && isCallableByPolicy(localTime, localDate);
  
      upsertTimeBadge(phoneCell, tzLabel, localTime, callableNow, unknownTz);
  
      phoneCell.dataset.calleeTzLabel = tzLabel || "";
      phoneCell.dataset.calleeLocalTime = localTime || "Unknown time";
      phoneCell.dataset.calleeUnknownTz = String(unknownTz);
      phoneCell.dataset.calleeCallable = String(callableNow);
  
      phoneCell.addEventListener(
        "click",
        async (e) => {
          blockRowNav(e);
  
          const currentPhone = (phoneCell.dataset.callPhone || "").trim();
          if (!currentPhone) return;
  
          // Re-evaluate time at click moment
          const areaNow = getAreaFromPhone(currentPhone);
          const [locNow, tzNow, timeNow, dateNow] = getAreaCodeInfoWithDate(areaNow);
          const unknownTzNow = !tzNow || tzNow === "Unknown" || !dateNow;
          const allowedNow = !unknownTzNow && isCallableByPolicy(timeNow, dateNow);
  
          // Update visuals
          upsertTimeBadge(phoneCell, tzNow, timeNow, allowedNow, unknownTzNow);
          const faPhoneIconAtClick = phoneCell.querySelector(".fa.fa-phone");
          if (faPhoneIconAtClick) {
            faPhoneIconAtClick.style.color = allowedNow ? CALL_UI.okColor : CALL_UI.blockColor;
            faPhoneIconAtClick.title = allowedNow
              ? "Within call window"
              : (unknownTzNow ? "Timezone unknown" : "Outside call window");
          }
  
          // Enforce policy
          if (unknownTzNow && !CALL_RULES.ALLOW_UNKNOWN_TZ && !CALL_RULES.WARN_ONLY) {
            alert(`Cannot dial. Timezone unknown for area ${areaNow}.`);
            return;
          }
          if (!allowedNow && !CALL_RULES.WARN_ONLY) {
            alert(`Cannot dial. Local time for area ${areaNow} (${tzNow || "TZ?"}) is ${timeNow || "unknown"}, outside your call window (${CALL_RULES.CALL_START_HOUR}:00–${CALL_RULES.CALL_END_HOUR}:00${CALL_RULES.BLOCK_WEEKENDS ? ", no weekends" : ""}).`);
            return;
          }
          if ((unknownTzNow && !CALL_RULES.ALLOW_UNKNOWN_TZ && CALL_RULES.WARN_ONLY) ||
              (!allowedNow && CALL_RULES.WARN_ONLY)) {
            const ok = confirm(
              `Outside policy:\n\n` +
              `Area ${areaNow} ${tzNow || ""} local time is ${timeNow || "unknown"}.\n\n` +
              `Proceed anyway?`
            );
            if (!ok) return;
          }
  
          // Proceed with dialing
          document.querySelector("#end-call-button")?.click();
          document.querySelector(".end-call-btn")?.click();
  
          setInputValueSecurely(dialerInput, "");
          await simulateSecureTyping(dialerInput, currentPhone);
  
          const dialBtn = document.querySelector(".dial-item.dial-btn.dial-btn-enabled");
          if (dialBtn) {
            phoneCell.dataset.callMade = true;
            console.log('phoneCell.parentNode', phoneCell.parentNode);
            document.querySelector('[aria-label="Toggle Power Dialer"]')?.click();
            await dialBtn.click();
            phoneCell.parentNode.style.backgroundColor = "lightgray";
          }
        },
        true
      );
  
      phoneCell.dataset.callListenerAttached = "1";
  
      // Replace existing icon with Font Awesome phone icon
      const existingIcon = phoneCell.querySelector(".icon-phone-svg");
      if (existingIcon) existingIcon.remove();
  
      const faPhoneIcon = document.createElement("i");
      faPhoneIcon.classList.add("fa", "fa-phone");
      faPhoneIcon.style.color = callableNow ? CALL_UI.okColor : CALL_UI.blockColor;
      faPhoneIcon.title = callableNow ? "Within call window" : (unknownTz ? "Timezone unknown" : "Outside call window");
      phoneCell.prepend(faPhoneIcon);
    });
  }
  
  async function autoDispoCall() {
    if (!location.href.includes('/contacts/detail/')) return;
    const counts = await extractContactData();
    let dispo = await getDisposition();
  
    if (!counts) return;
      
    if (dispo === "" && counts.calls.outbound.count > 6 && counts.calls.outbound.count < 9) {
       setDisposition("Move to Contacted");
       return;
    }
    
    if (dispo === "Move to Contacted" && counts.calls.outbound.count > 9) {
       setDisposition("Move to Final Contact");
       return;
    }
    
    if (dispo === "Move to Final Contact" && counts.calls.outbound.count > 4) {
       // setDisposition("Unable to reach");
       return;
    }
  }
  
  
  (function() {
      'use strict';
  
      const config = window.scriptConfig || {};
      const showBanner = config.showBanner || false;    
      if (showBanner) {
          const bannerMsg = config.bannerMsg || 'Default message';
          const bannerBGColor = config.bannerBGColor || '#333';
      
          const banner = document.createElement('div');
          banner.textContent = bannerMsg;
          banner.style.cssText = `
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              background: ${bannerBGColor};
              color: white;
              padding: 8px;
              font-size: 14px;
              z-index: 99999;
              text-align: center;
          `;
          document.body.appendChild(banner);
      }
      
      // Main interval loop every 1 second
      setInterval(() => {
          (async () => {
              const urlChanged = await checkUrlChange();
              const url = location.href;
              const onContactPage = isOnContactPage(url);
  
              cLog("-----------------------------------------------1----------------------------------------------");
  
              if (onContactPage) {
  
                  if (!initialized && document.querySelector('div[class="filter-option-inner-inner"]')) initialized = true;
  
                  updateBanner();
                  cLog("-----------------------------------------------2----------------------------------------------");
                  cLog("-----------------------------------------------3----------------------------------------------");
  
                  // open notes tab immediatey upon entering contact
                  if (!hasClickedNotesTab && document.querySelector(".hl_contact-details-new--wrap")) {
                      clickTab('notes');
  
                      // confirm notes tab has been opened
                      const notesContainer = document.getElementById("notes-list-container-contact");
                      if (notesContainer) {
                          hasClickedNotesTab = true;
                      }
                  }
  
                  // add menus
                  addScriptChecklistMenu();
                  // addTextMessageMenu();
  
                  addTemplateMenu({
                      menuId: 'tb_sms_menu',
                      menuLabel: 'Text',
                      type: 'sms',
                      rightOf: 'tb_script_menu'
                  });
  
                  addTemplateMenu({
                      menuId: 'tb_email_menu',
                      menuLabel: 'Email',
                      type: 'email',
                      rightOf: 'tb_sms_menu'
                  });
  
                  addTemplateMenu({
                      menuId: 'tb_voicemail_menu',
                      menuLabel: 'Voicemail',
                      type: 'voicemail',
                      rightOf: 'tb_email_menu'
                  });
  
                  addQuickNotesMenu();
  
                  removePostDialModal();
                  shrinkCenterPanelHeight();
  
                  timeRestriction();
                  hideWhatsAppTab();
                  autoDispositionOfferMade();
                  autoResizeNotes();
                  monMonFreeFloat();
                  hideCallSummaryNotes();
                  await extractNoteData();
  
                  moveFieldByLabel('Call Result (Choose carefully, as automations are triggered when you select)');
                  moveFieldByLabel('Asking Price');
                  moveFieldByLabel('Our Offer Price');
                  moveFieldByLabel('Acreage');
                  moveFieldByLabel('APN');
  
                  // reduce function calls in an attempt to improve performance
                  iterationCount++;
                  if (iterationCount >= 5) {
                      populateFieldsWithExtractedData();
                      myStatsWidget();
                      iterationCount = 0;
                  }
  
                autoDispoCall();
                setSecondaryDisposition();
                
                  // execute extractNoteData once
                  // if (!hasRunExtractNoteData) {
                  //     extractNoteData();
                  //     hasRunExtractNoteData = true;
                  // }
  
              } else {
              }
  
              modalBanner();
              avatarHref();
              attachPhoneDialHandlers();
              populateCallQueue();
              moveCallBtn();
              showDateInTimestamps();
              cleanupSidebarAndWidgets();
              updateContactsToCustomURLs();
              updateBannerSlideElements();
              updateDocuSealIframeSrc();
              openConversationSameWindow();
              conversationsBanner();
  
              // cleanupDetachedDOMNodes();
          })();
      }, 1000);
  })();
