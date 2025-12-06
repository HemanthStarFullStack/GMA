const google = require('googlethis');

async function testSearch() {
    // 8901030974360 is a common Indian barcode (Dove Soap or similar)
    const barcode = '8901030974360';
    const query = `${barcode}`;

    console.log(`Searching for: ${query}`);

    try {
        const response = await google.search(query, {
            page: 0,
            safe: false,
            additional_params: {
                hl: 'en', // English
                gl: 'in'  // India region
            }
        });

        console.log("Results found:", response.results.length);

        if (response.results.length > 0) {
            console.log("Top Result Title:", response.results[0].title);
            console.log("Top Result Desc:", response.results[0].description);
        }

        // Also try 'knowledge_panel' if available
        if (response.knowledge_panel && (response.knowledge_panel.title || response.knowledge_panel.name)) {
            console.log("Knowledge Panel:", response.knowledge_panel.title || response.knowledge_panel.name);
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

testSearch();
