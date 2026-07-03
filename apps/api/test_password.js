const bcrypt = require('bcrypt');

async function test() {
    const password = 'test1234';
    const hash = '$2b$12$EEg1GUW0bABlklQEywrDauex8zrSp7b0oJP8SYF0dhE5g1NMgBslq';
    
    console.log('Password:', password);
    console.log('Hash:', hash);
    
    try {
        const result = await bcrypt.compare(password, hash);
        console.log('Compare result:', result);
    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();
