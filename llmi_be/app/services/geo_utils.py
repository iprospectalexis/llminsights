"""
Utility for extracting ISO country codes from geo_targeting strings.

geo_targeting can be:
- A 2-letter ISO code: "FR", "US", "KR"
- A full geo string: "Paris,Paris,Ile-de-France,France"
- A city/country name: "France", "United States"
"""

# Mapping of country names to ISO 3166-1 alpha-2 codes
COUNTRY_NAME_TO_CODE = {
    "france": "FR",
    "united states": "US",
    "united kingdom": "GB",
    "germany": "DE",
    "spain": "ES",
    "italy": "IT",
    "portugal": "PT",
    "netherlands": "NL",
    "belgium": "BE",
    "switzerland": "CH",
    "austria": "AT",
    "canada": "CA",
    "australia": "AU",
    "japan": "JP",
    "south korea": "KR",
    "korea": "KR",
    "korea republic of": "KR",
    "china": "CN",
    "india": "IN",
    "brazil": "BR",
    "mexico": "MX",
    "argentina": "AR",
    "russia": "RU",
    "turkey": "TR",
    "poland": "PL",
    "sweden": "SE",
    "norway": "NO",
    "denmark": "DK",
    "finland": "FI",
    "ireland": "IE",
    "czech republic": "CZ",
    "romania": "RO",
    "hungary": "HU",
    "greece": "GR",
    "israel": "IL",
    "saudi arabia": "SA",
    "united arab emirates": "AE",
    "singapore": "SG",
    "malaysia": "MY",
    "thailand": "TH",
    "indonesia": "ID",
    "vietnam": "VN",
    "philippines": "PH",
    "new zealand": "NZ",
    "south africa": "ZA",
    "colombia": "CO",
    "chile": "CL",
    "peru": "PE",
    "egypt": "EG",
    "nigeria": "NG",
    "morocco": "MA",
    "tunisia": "TN",
    "algeria": "DZ",
    "ukraine": "UA",
    "croatia": "HR",
    "serbia": "RS",
    "bulgaria": "BG",
    "slovakia": "SK",
    "luxembourg": "LU",
    "taiwan": "TW",
    "hong kong": "HK",
}

# All valid ISO 3166-1 alpha-2 codes
VALID_ISO_CODES = {
    "AF", "AX", "AL", "DZ", "AS", "AD", "AO", "AI", "AQ", "AG", "AR", "AM",
    "AW", "AU", "AT", "AZ", "BS", "BH", "BD", "BB", "BY", "BE", "BZ", "BJ",
    "BM", "BT", "BO", "BQ", "BA", "BW", "BV", "BR", "IO", "BN", "BG", "BF",
    "BI", "CV", "KH", "CM", "CA", "KY", "CF", "TD", "CL", "CN", "CX", "CC",
    "CO", "KM", "CG", "CD", "CK", "CR", "CI", "HR", "CU", "CW", "CY", "CZ",
    "DK", "DJ", "DM", "DO", "EC", "EG", "SV", "GQ", "ER", "EE", "SZ", "ET",
    "FK", "FO", "FJ", "FI", "FR", "GF", "PF", "TF", "GA", "GM", "GE", "DE",
    "GH", "GI", "GR", "GL", "GD", "GP", "GU", "GT", "GG", "GN", "GW", "GY",
    "HT", "HM", "VA", "HN", "HK", "HU", "IS", "IN", "ID", "IR", "IQ", "IE",
    "IM", "IL", "IT", "JM", "JP", "JE", "JO", "KZ", "KE", "KI", "KP", "KR",
    "KW", "KG", "LA", "LV", "LB", "LS", "LR", "LY", "LI", "LT", "LU", "MO",
    "MG", "MW", "MY", "MV", "ML", "MT", "MH", "MQ", "MR", "MU", "YT", "MX",
    "FM", "MD", "MC", "MN", "ME", "MS", "MA", "MZ", "MM", "NA", "NR", "NP",
    "NL", "NC", "NZ", "NI", "NE", "NG", "NU", "NF", "MK", "MP", "NO", "OM",
    "PK", "PW", "PS", "PA", "PG", "PY", "PE", "PH", "PN", "PL", "PT", "PR",
    "QA", "RE", "RO", "RU", "RW", "BL", "SH", "KN", "LC", "MF", "PM", "VC",
    "WS", "SM", "ST", "SA", "SN", "RS", "SC", "SL", "SG", "SX", "SK", "SI",
    "SB", "SO", "ZA", "GS", "SS", "ES", "LK", "SD", "SR", "SJ", "SE", "CH",
    "SY", "TW", "TJ", "TZ", "TH", "TL", "TG", "TK", "TO", "TT", "TN", "TR",
    "TM", "TC", "TV", "UG", "UA", "AE", "GB", "US", "UM", "UY", "UZ", "VU",
    "VE", "VN", "VG", "VI", "WF", "EH", "YE", "ZM", "ZW",
}


def extract_country_code(geo_targeting: str, default: str = "") -> str:
    """
    Extract a 2-letter ISO country code from a geo_targeting string.

    Examples:
        "FR" -> "FR"
        "Paris,Paris,Ile-de-France,France" -> "FR"
        "France" -> "FR"
        "" -> default
    """
    if not geo_targeting:
        return default

    value = geo_targeting.strip()

    # Already a 2-letter ISO code?
    if len(value) == 2 and value.upper() in VALID_ISO_CODES:
        return value.upper()

    # Comma-separated geo string: last part is usually the country name
    if "," in value:
        country_name = value.rsplit(",", 1)[-1].strip().lower()
    else:
        country_name = value.lower()

    code = COUNTRY_NAME_TO_CODE.get(country_name)
    if code:
        return code

    return default
