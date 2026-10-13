export { versions, knownIssues };

// Define the version history of the simulator. This information will be displayed in the top of the simulator.
// Latest version should be first in the list. Each entry should have a version number, release date, and notes about the changes made in that version.
const versions = [
  { version: "BETA-0.34", date: "2026-10-13", notes: "Version and known issues handling updated" },
  { version: "BETA-0.33", date: "2026-10-13", notes: "Simulator name change and description update" },
  { version: "BETA-0.32", date: "2026-10-13", notes: "Fixed issue with work item processing time calculation in case of parallel processing by multiple teams." },
  { version: "BETA-0.31", date: "2026-10-12", notes: "Added button to hide/show the process flow view." },
  { version: "BETA-0.30", date: "2026-10-05", notes: "Initial beta release." },
];

// List known issues that users should be aware of when using the simulator. They will be shown in the "About" section.
const knownIssues = [
  { issue: "The simulation output will make the screen 'jump' up and down a bit during execution. This is due to how the team view is adjusted, based on work items processed in each team stage." },
];