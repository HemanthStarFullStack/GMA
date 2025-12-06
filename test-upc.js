async function testUPC() {
    // Common Barcode (Coke/Pepsi or similar often works) or the Indian one
    const barcode = '8901030974360'; // Dove Soap India
    const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`;

    console.log(`Testing UPCitemDB: ${url}`);

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
