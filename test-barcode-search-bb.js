const google = require('googlethis');

async function testSearch() {
    // 8901030974360 is a common Indian barcode (Dove Soap)
    // trying site specific search
    const barcode = '8901030974360';
    const query = `site:bigbasket.com ${barcode}`;

    console.log(`Searching for: ${query}`);

    try {
        const response = await google.search(query, {
            page: 0,
            safe: false,
            additional_params: {
                hl: 'en',
                gl: 'in'
            }
        });

        console.log("Results found:", response.results.length);

        if (response.results.length > 0) {
            console.log("Top Result Title:", response.results[0].title);
            console.log("Top Result Desc:", response.results[0].description);
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

testSearch();
