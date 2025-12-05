const https = require('https');
const fs = require('fs');

const API_KEY = "AIzaSyDnez21roY1FtgN-E3gMYkCpQyt5AUAhs4";
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (json.models) {
                const names = json.models.map(m => m.name.replace('models/', '')).filter(n => n.includes('gemini'));
                fs.writeFileSync('model_names.txt', names.join('\n'));
                console.log('Wrote models to model_names.txt');
            } else {
                console.log('No models found or error', json);
            }
        } catch (e) { console.error(e); }
    });
});
