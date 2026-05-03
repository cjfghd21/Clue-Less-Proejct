// server/game/Game.js
const Board = require('./Board');
const Deck = require('./Deck');

class Game {
  constructor(io) {
    this.io = io;
    this.winner = null;
    this.board = new Board();
    this.players = [];           // { id, character, location, hand: [], eliminated: false }
    this.turnIndex = 0;
    this.currentPlayerId = null;
    this.solution = null;
    this.gameOver = false;
    this.occupiedHallways = [];
    this.lastSuggestion = null;  // for disprove flow
    this.pendingDisprove = null; 
  }

  addPlayer(socketId, character) {
    if (this.players.length >= 6) return false;
    
    //check if player already taken.
    const characterTaken = this.players.some(
      player => player.character === character
    );
    if (characterTaken) return false;
  

    const start = this.board.getStartingHallway(character);
    this.players.push({
      id: socketId,
      character,
      location: start,
      moved: false,   //track if player moved this turn. make it false after end turn.
      ready: false,
      suggested: false,
      hand: [],
      eliminated: false
    });
    this.occupiedHallways.push(start);
    return true;
  }

  removePlayer(socketId) {
    const index = this.players.findIndex(
        player => player.id === socketId
    );

    if (index !== -1) {
        const removedPlayer = this.players.splice(index, 1)[0];
        return removedPlayer;
    }

    return null;
  }

  

  startGame() {
    
    console.log("Players currently in game:", this.players.map(p => ({
      id: p.id,
      character: p.character
    })));

    //min 3 players
    if (this.players.length < 3) {
      return false; // Not enough players
    }

    //check ready
    if (!this.players.every(p => p.ready)) {
      return false;
    }

    const deck = new Deck();
    this.solution = deck.dealSolution();
    const hands = deck.dealHands(this.players.length, this.solution);
    
    //resetting winner and last suggestion
    this.winner = null;
    this.lastSuggestion = null;
    //logging solution cards.
    console.log(
      `ANSWER CARDS -> Suspect: ${this.solution.suspect}, Weapon: ${this.solution.weapon}, Room: ${this.solution.room}`
    );

    this.players.forEach((p, i) =>{
       p.hand = hands[i];
       p.moved = false;
       p.suggested = false;
    });
      
    
    this.currentPlayerId = this.players[0].id;
    this.gameOver = false;

    return true
  }

  playerMove(playerId, targetLoc) {
    const player = this.players.find(p => p.id === playerId);

    if (!player || player.id !== this.currentPlayerId || player.moved || this.gameOver) {
      return false;
    }

    if (this.board.isValidMove(player.location, targetLoc, this.occupiedHallways)) {
      if (this.board.locations[player.location]?.type === "hallway") {
        this.occupiedHallways = this.occupiedHallways.filter(h => h !== player.location);
      }

      player.location = targetLoc;

      if (this.board.locations[targetLoc]?.type === "hallway") {
        this.occupiedHallways.push(targetLoc);
      }

      player.moved = true;
      this.broadcastGameState();
      return true;
    }

    return false;
  }

  makeSuggestion(playerId, suspect, weapon) {
    const player = this.players.find(p => p.id === playerId);

    if (!player || player.id !== this.currentPlayerId || player.suggested) {
      return false;
    }

    if (this.board.locations[player.location].type !== "room") {
      return false;
    }

    player.suggested = true;

    this.lastSuggestion = {
      room: player.location,
      suspect,
      weapon,
      suggester: player.character
    };

    this.pendingDisprove = {
      suggesterId: player.id,
      suggesterCharacter: player.character,
      suspect,
      weapon,
      room: player.location,
      responderId: null,
      responderCharacter: null,
      matchingCards: []
    };

    const suspectPlayer = this.players.find(p => p.character === suspect);
    if (suspectPlayer) {
      const oldLoc = suspectPlayer.location;
      if (this.board.locations[oldLoc]?.type === "hallway") {
        this.occupiedHallways = this.occupiedHallways.filter(h => h !== oldLoc);
      }
      suspectPlayer.location = player.location;
    }

    this.broadcastGameState();
    this.triggerDisprove();
    return true;
  }

  triggerDisprove() {
    if (!this.pendingDisprove) return false;

    const suggesterIndex = this.players.findIndex(
      p => p.id === this.pendingDisprove.suggesterId
    );

    const summary =
      `${this.pendingDisprove.suggesterCharacter} suggested ` +
      `${this.pendingDisprove.suspect}, ${this.pendingDisprove.weapon}, ${this.pendingDisprove.room}.`;

    for (let step = 1; step < this.players.length; step++) {
      const idx = (suggesterIndex + step) % this.players.length;
      const candidate = this.players[idx];

      const matches = this.getMatchingCards(candidate, this.pendingDisprove);

      if (matches.length > 0) {
        this.pendingDisprove.responderId = candidate.id;
        this.pendingDisprove.responderCharacter = candidate.character;
        this.pendingDisprove.matchingCards = matches;

        // Suggester
        this.io.to(this.pendingDisprove.suggesterId).emit("SUGGESTION_STATUS", {
          message: `${summary} Waiting for ${candidate.character} to disprove...`
        });

        // Matching player
        this.io.to(candidate.id).emit("SUGGESTION_STATUS", {
          message: `${summary} You must present a matching card.`
        });

        // Everyone else
        this.players.forEach(player => {
          if (
            player.id !== this.pendingDisprove.suggesterId &&
            player.id !== candidate.id
          ) {
            this.io.to(player.id).emit("SUGGESTION_STATUS", {
              message: summary
            });
          }
        });

        this.io.to(candidate.id).emit("DISPROVE_REQUEST", {
          cards: matches,
          message: `${summary} You must present a matching card.`
        });

        return true;
      }
    }

    const summaryNoDisprove =
      `${this.pendingDisprove.suggesterCharacter} suggested ` +
      `${this.pendingDisprove.suspect}, ${this.pendingDisprove.weapon}, ${this.pendingDisprove.room}. ` +
      `No one could disprove your suggestion.`;

    this.players.forEach(player => {
      this.io.to(player.id).emit("SUGGESTION_STATUS", {
        message: summaryNoDisprove
      });
    });

    this.pendingDisprove = null;
    this.lastSuggestion = null;

    this.broadcastGameState();
    return true;
  }

  respondToSuggestion(playerId, cardShown) {
    if (!this.pendingDisprove) return false;
    if (playerId !== this.pendingDisprove.responderId) return false;
    if (!this.pendingDisprove.matchingCards.includes(cardShown)) return false;

    const suggesterId = this.pendingDisprove.suggesterId;
    const responderId = this.pendingDisprove.responderId;
    const responderCharacter = this.pendingDisprove.responderCharacter;

    const summary =
      `${this.pendingDisprove.suggesterCharacter} suggested ` +
      `${this.pendingDisprove.suspect}, ${this.pendingDisprove.weapon}, ${this.pendingDisprove.room}.`;

    this.players.forEach(player => {
      if (player.id === suggesterId) {
        this.io.to(player.id).emit("SUGGESTION_STATUS", {
          message: `${summary} ${responderCharacter} showed ${cardShown}.`
        });
      } else if (player.id !== responderId) {
        this.io.to(player.id).emit("SUGGESTION_STATUS", {
          message: `${summary} ${responderCharacter} showed a card.`
        });
      }
    });

    this.pendingDisprove = null;
    this.lastSuggestion = null;

    this.broadcastGameState();
    return true;
  }

  //return: sucess is method ran as intended.   correct: whether accusation is correct or wrong
  makeAccusation(playerId, suspect, weapon, room) {
    const player = this.players.find(p => p.id === playerId);

    if (!player || player.id !== this.currentPlayerId || player.eliminated || this.gameOver) {
      return { success: false, correct: false };
    }

    const correct =
      suspect === this.solution.suspect &&
      weapon === this.solution.weapon &&
      room === this.solution.room;

    if (correct) {
      this.gameOver = true;
      this.winner = player.character;
      this.currentPlayerId = null;
      this.lastSuggestion = null;
      this.broadcastGameState();
      return { success: true, correct: true };
    } else {
      player.eliminated = true;
      this.lastSuggestion = null;
      this.nextTurn();
      return { success: true, correct: false };
    }
  }

  nextTurn() {
    const activePlayers = this.players.filter(p => !p.eliminated);

    if (activePlayers.length === 0) {
      this.gameOver = true;
      this.winner = null;
      this.currentPlayerId = null;
      this.lastSuggestion = null;
      this.broadcastGameState();
      return;
    }

    do {
      this.turnIndex = (this.turnIndex + 1) % this.players.length;
    } while (this.players[this.turnIndex].eliminated);

    this.currentPlayerId = this.players[this.turnIndex].id;

    const current = this.players[this.turnIndex];
    current.moved = false;
    current.suggested = false;

    this.broadcastGameState();
  }

  endTurn(playerId) {
    const player = this.players.find(p => p.id === playerId);

    if (!player || player.id !== this.currentPlayerId || this.gameOver) {
      return false;
    }

    // Clear last suggestion so temp summoned inactive sprites disappear on next update
    this.lastSuggestion = null;

    this.nextTurn();
    return true;
  }


  getGameState(extra = {}) {
    return {
      players: this.players.map(p => ({
        id: p.id,
        character: p.character,
        location: p.location,
        eliminated: p.eliminated,
        moved: p.moved,
        suggested: p.suggested,
        ready: p.ready
      })),
      currentPlayer: this.currentPlayerId,
      gameOver: this.gameOver,
      lastSuggestion: this.lastSuggestion,
      winner: this.winner,
      solution: this.gameOver ? this.solution : null,
      ...extra
    };
  }

  broadcastGameState(extra = {}) {
    const state = {
      players: this.players.map(p => ({
        id: p.id,
        character: p.character,
        location: p.location,
        eliminated: p.eliminated,
        moved: p.moved,
        suggested: p.suggested,
        ready: p.ready
      })),
      currentPlayer: this.currentPlayerId,
      gameOver: this.gameOver,
      lastSuggestion: this.lastSuggestion,
      winner: this.winner,
      solution: this.gameOver ? this.solution : null,
      ...extra
    };

    if (!this.io){
      console.error("Socekt.IO instance not initialized in Game");
      return;
    }

    this.io.emit("GAME_STATE_UPDATE", state);

    // In Socket{} code: io.emit('GAME_STATE_UPDATE', state);
    // Private hand is sent separately to each player
  }

  //sends card to players
  getPrivateHand(playerId) {
    const player = this.players.find(p => p.id === playerId);
    return player ? player.hand : [];
  }

  getMatchingCards(player, suggestion) {
    const targets = new Set([suggestion.suspect, suggestion.weapon, suggestion.room]);
    return player.hand.filter(card => targets.has(card));
  }

  toggleReady(playerId) {
    const player = this.players.find(p => p.id === playerId);

    if (!player || this.currentPlayerId !== null || this.gameOver) {
      return false;
    }

    player.ready = !player.ready;
    return true;
  }
  
}

module.exports = Game;