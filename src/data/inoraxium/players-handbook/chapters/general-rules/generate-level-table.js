const fs = require("fs");
const path = require("path");

let rows = [];

for (let level = 1; level <= 50; level++) {
  rows.push(`<tr><td>${level}</td><td>${xpFormula(level)-xpFormula(level-1)}</td><td>${xpFormula(level-1)}</td><td>${Math.ceil(level / 5) + 1}</td></tr>`);
}

const table = `
<table class="tableRow">
  <thead>
    <tr>
      <th>Level</th>
      <th>XP to Next Level</th>
      <th>Total XP</th>
      <th>Proficiency Bonus</th>
    </tr>
  </thead>
  <tbody>
    ${rows.join("\n")}
  </tbody>
</table>
`;

// Dosya yolu (aynı klasör)
const filePath = path.join(__dirname, "level-table.md");

// Dosyaya yaz
fs.writeFileSync(filePath, table.trim(), "utf8");


// XP
  function xpFormula(index) {

    if (index === 0) return 0;
    if (index === 1) return xpFormula(index-1) + 100;
    if (index === 2) return xpFormula(index-1) + 200;
    if (index === 3) return xpFormula(index-1) + 340;
    if (index > 3 && index < 24) return xpFormula(index-1) + xpFormulaNext(index-3);
    if (index === 24) return xpFormula(index-1) + 1;

  }
  
  function xpFormulaNext(index) {

    if (index === 0) return 340;
    else return Math.ceil(xpFormulaNext(index-1) * 1.5);

  }

  const newXPTable = [];
  for (let i = 0; i <= 24; i++) {
    if (i === 0) {
      newXPTable.push(0);
    } else {
      newXPTable.push(xpFormula(i));
    }
  }