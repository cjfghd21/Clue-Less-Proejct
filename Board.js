// server/game/Board.js
class Board {
  constructor() {
    this.locations = {
      // Rooms
      "Study":        { type: "room", secretTo: "Kitchen" },
      "Hall":         { type: "room" },
      "Lounge":       { type: "room", secretTo: "Conservatory" },
      "Library":      { type: "room" },
      "Billiard Room": { type: "room" },
      "Dining Room":  { type: "room" },
      "Conservatory": { type: "room", secretTo: "Lounge" },
      "Ballroom":     { type: "room" },
      "Kitchen":      { type: "room", secretTo: "Study" },

      // Hallways (matches your Unity hierarchy)
      "Hallway1":  { type: "hallway", connects: ["Study", "Hall"] },
      "Hallway2":  { type: "hallway", connects: ["Hall", "Lounge"] },
      "Hallway3":  { type: "hallway", connects: ["Study", "Library"] },
      "Hallway4":  { type: "hallway", connects: ["Hall", "Billiard Room"] },
      "Hallway5":  { type: "hallway", connects: ["Lounge", "Dining Room"] },
      "Hallway6":  { type: "hallway", connects: ["Library", "Billiard Room"] },
      "Hallway7":  { type: "hallway", connects: ["Billiard Room", "Dining Room"] },
      "Hallway8":  { type: "hallway", connects: ["Library", "Conservatory"] },
      "Hallway9":  { type: "hallway", connects: ["Billiard Room", "Ballroom"] },
      "Hallway10": { type: "hallway", connects: ["Dining Room", "Kitchen"] },
      "Hallway11": { type: "hallway", connects: ["Conservatory", "Ballroom"] },
      "Hallway12": { type: "hallway", connects: ["Ballroom", "Kitchen"] }
    };
  }

  isValidMove(current, target, occupiedHallways) {
    if (!this.locations[current] || !this.locations[target]) return false;

    // Secret passage
    if (this.locations[current].secretTo === target) return true;

    // Room → adjacent hallway (must be empty)
    if (this.locations[current].type === "room" && this.locations[target].type === "hallway") {
      return this.locations[target].connects.includes(current) && !occupiedHallways.includes(target);
    }

    // Hallway → one of its two rooms
    if (this.locations[current].type === "hallway" && this.locations[target].type === "room") {
      return this.locations[current].connects.includes(target);
    }

    return false;
  }

  getValidMoves(current, occupiedHallways) {
    const moves = [];
    for (let loc in this.locations) {
      if (this.isValidMove(current, loc, occupiedHallways)) moves.push(loc);
    }
    return moves;
  }

  getStartingHallway(character) {
    const map = {
      "Prof. Plum": "Hallway3", "Mrs. Peacock": "Hallway8", "Mr. Green": "Hallway9",
      "Miss Scarlet": "Hallway2", "Col. Mustard": "Hallway5", "Mrs. White": "Hallway12"
    };
    return map[character];
  }
}

module.exports = Board;