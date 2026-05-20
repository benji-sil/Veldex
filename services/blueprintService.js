/**
 * Blueprint Service for fetching Star Citizen Blueprint Data
 * 
 * Based on research, the Star Citizen Wiki API is the best source for blueprints.
 * UEX API is primarily for commodities and trade prices and requires category IDs to query items.
 */

/**
 * Fetch a list of blueprint names and basic details from the SC Wiki API.
 * Uses the /api/blueprints endpoint.
 */
export async function fetchBlueprintNames() {
    try {
        let allRawBlueprints = [];
        let currentPage = 1;
        let lastPage = 1;

        // Fetch all pages to ensure no categories are missed
        do {
            const response = await fetch(`https://api.star-citizen.wiki/api/blueprints?limit=100&page=${currentPage}`);
            if (!response.ok) {
                console.error('Failed to fetch blueprints on page', currentPage, response.statusText);
                break;
            }
            
            const json = await response.json();
            if (json.data && json.data.length > 0) {
                allRawBlueprints = allRawBlueprints.concat(json.data);
            }
            
            if (json.meta && json.meta.last_page) {
                lastPage = json.meta.last_page;
            } else {
                break; // Fallback to break if no meta pagination exists
            }
            currentPage++;
        } while (currentPage <= lastPage);
        
        console.log("BLUEPRINT RAW API COUNT:", allRawBlueprints.length);
        
        // Map the results to a consistent, normalized format for autocomplete
        const normalizedBlueprints = allRawBlueprints.map(bp => {
            const name = bp.output_name || bp.output?.name || bp.name || bp.key;
            const category = bp.output?.type_label || bp.type_label || bp.category || 'Blueprint';
            const ingredientsText = bp.ingredients ? bp.ingredients.map(ing => ing.item?.name || '').join(" ") : "";
            
            return {
                name: name,
                blueprint_uuid: bp.uuid,
                output_item_uuid: bp.output_item_uuid,
                category: category,
                ingredient_names: ingredientsText,
                is_available_by_default: !!bp.is_available_by_default,
                unlocking_missions_count: bp.unlocking_missions_count || 0
            };
        });

        console.log("BLUEPRINT NORMALIZED COUNT:", normalizedBlueprints.length);
        console.log("BLUEPRINT CATEGORIES:", [...new Set(normalizedBlueprints.map(b => b.category))]);
        
        return normalizedBlueprints;
    } catch (error) {
        console.error('Error fetching blueprint names:', error);
        return [];
    }
}

/**
 * Search blueprints locally or via API.
 * 
 * @param {string} query The search string
 * @param {Array} blueprints Optional array of blueprints to filter. If not provided or empty, it will fetch them.
 */
export async function searchBlueprints(query, blueprints = null) {
    let data = blueprints;
    if (!data || data.length === 0) {
        data = await fetchBlueprintNames();
    }
    
    if (!query) {
        return data; // Return all if query is empty
    }
    
    const lowerQuery = query.toLowerCase();
    const results = data.filter(bp => 
        (bp.name && bp.name.toLowerCase().includes(lowerQuery)) || 
        (bp.category && bp.category.toLowerCase().includes(lowerQuery)) ||
        (bp.ingredient_names && bp.ingredient_names.toLowerCase().includes(lowerQuery))
    );
    
    console.log("BLUEPRINT SEARCH RESULTS:", results);
    return results;
}
