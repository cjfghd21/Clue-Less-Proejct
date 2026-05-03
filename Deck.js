// server/game/Deck.js
class Deck {
  constructor() {
    this.suspects = ["Prof. Plum", "Mrs. Peacock", "Mr. Green", "Miss Scarlet", "Col. Mustard", "Mrs. White"];
    this.weapons  = ["Candlestick", "Knife", "Lead Pipe", "Revolver", "Rope", "Wrench"];
    this.rooms    = ["Study", "Hall", "Lounge", "Library", "Billiard Room", "Dining Room", "Conservatory", "Ballroom", "Kitchen"];
  }

  dealSolution() {
    return {
      suspect: this.suspects[Math.floor(Math.random() * this.suspects.length)],
      weapon:  this.weapons[Math.floor(Math.random() * this.weapons.length)],
      room:    this.rooms[Math.floor(Math.random() * this.rooms.length)]
    };
  }

  dealHands(numPlayers, solution) {
    let allCards = [...this.suspects, ...this.weapons, ...this.rooms];

    allCards = allCards.filter(c =>
      !Object.values(solution).includes(c)
    );

    allCards = allCards.sort(() => Math.random() - 0.5);
    const hands = Array.from({ length: numPlayers }, () => []);
    allCards.forEach((card, i) => hands[i % numPlayers].push(card));
    return hands;
  }
}

module.exports = Deck;