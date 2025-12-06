async function testUPC() {
    // Known Good UPC (Coca Cola 12 pack or single can)
    // 049000000443 (Diet Coke 12oz)
    const barcode = '049000000443';
    const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`;

    console.log(`Testing UPCitemDB with US UPC: ${url}`);

    try {
        const response = await fetch(url);
        const data = await response.json();

        console.log("Status:", response.status);
        console.log("Response:", JSON.stringify(data, null, 2));

    } catch (e) {
        console.error("Error:", e);
    }
}

testUPC();
