import countriesData from './countries_names_codes_flags.csv?raw';

export interface Country {
  code: string;
  name: string;
  flag: string;
}

export function parseCountriesData(): Country[] {
  const lines = countriesData.split('\n');
  const countries: Country[] = [];
  
  // Skip header line and process data lines
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Split by semicolon and clean up the data
    const parts = line.split(';');
    if (parts.length >= 3) {
      const code = parts[0].trim();
      const name = parts[1].trim();
      const flag = parts[2].trim();
      
      if (code && name && flag) {
        countries.push({ code, name, flag });
      }
    }
  }
  
  // Define top 6 countries to prioritize
  const topCountryCodes = ['FR', 'US', 'GB', 'DE', 'IT', 'ES'];
  
  // Separate top countries from others
  const topCountries: Country[] = [];
  const otherCountries: Country[] = [];
  
  countries.forEach(country => {
    if (topCountryCodes.includes(country.code)) {
      topCountries.push(country);
    } else {
      otherCountries.push(country);
    }
  });
  
  // Sort top countries by the predefined order
  topCountries.sort((a, b) => {
    return topCountryCodes.indexOf(a.code) - topCountryCodes.indexOf(b.code);
  });
  
  // Sort other countries alphabetically
  otherCountries.sort((a, b) => a.name.localeCompare(b.name));
  
  // Return top countries first, then others
  return [...topCountries, ...otherCountries];
}

export const countries = parseCountriesData();

// Helper function to get country by code
export function getCountryByCode(code: string): Country | undefined {
  return countries.find(country => country.code === code);
}