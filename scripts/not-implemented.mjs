// Placeholder for scripts that land in later milestones. Exits 0 so CI stays green.
const [name = "script", milestone = "a later milestone"] = process.argv.slice(2);
console.log(`${name}: not implemented until ${milestone}. Nothing to run yet.`);
