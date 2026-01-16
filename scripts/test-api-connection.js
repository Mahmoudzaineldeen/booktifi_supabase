// Quick test to verify API is working
const response = await fetch('http://localhost:3001/api/health');
const data = await response.json();
console.log('API Health:', data);
