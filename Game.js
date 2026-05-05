// server/game/Game.js
const Board = require('./Board');
const Deck = require('./Deck');

class Game {
  constructor(io,roomCode) {
    this.io = io;
    this.roomCode = roomCode;
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
    const index = this.players.findIndex(player => player.id === socketId);

    if (index === -1) {
      return null;
    }

    const removedPlayer = this.players[index];
    const wasCurrentPlayer = removedPlayer.id === this.currentPlayerId;

    // Remove the player
    this.players.splice(index, 1);

    // Free hallway if removed player was standing in one
    if (
      removedPlayer.location &&
      this.board.locations[removedPlayer.location]?.type === "hallway"
    ) {
      this.occupiedHallways = this.occupiedHallways.filter(
        h => h !== removedPlayer.location
      );
    }
    
    this.handlePendingDisproveAfterRemovedPlayer(removedPlayer);

    // If nobody remains, clear turn state
    if (this.players.length === 0) {
      this.currentPlayerId = null;
      this.turnIndex = 0;
      this.pendingDisprove = null;
      this.lastSuggestion = null;
      return removedPlayer;
    }

    // If a non-current player before the current turn index left,
    // adjust turnIndex so it still points to the same current player.
    if (!wasCurrentPlayer) {
      const currentIndex = this.players.findIndex(
        p => p.id === this.currentPlayerId
      );

      if (currentIndex !== -1) {
        this.turnIndex = currentIndex;
      }

      return removedPlayer;
    }

    // If the current player left, give turn to the next player.
    if (!this.gameOver) {
      // After splice, "index" now points to the next player.
      // If the removed player was last, wrap to 0.
      this.turnIndex = index % this.players.length;

      // Skip eliminated players
      let safety = 0;
      while (
        this.players[this.turnIndex].eliminated &&
        safety < this.players.length
      ) {
        this.turnIndex = (this.turnIndex + 1) % this.players.length;
        safety++;
      }

      const nextPlayer = this.players[this.turnIndex];

      if (nextPlayer && !nextPlayer.eliminated) {
        this.currentPlayerId = nextPlayer.id;

        // CRITICAL FIX:
        // New current player must get a fresh turn.
        nextPlayer.moved = false;
        nextPlayer.suggested = false;
      } else {
        this.gameOver = true;
        this.winner = null;
        this.currentPlayerId = null;
      }
    }

    // Clear pending suggestion/disprove flow if the current player left mid-turn
    this.pendingDisprove = null;
    this.lastSuggestion = null;

    return removedPlayer;
  }


  //find next nearest turn player who can disprove if disproving player disconnects 
  handlePendingDisproveAfterRemovedPlayer(removedPlayer) {
    if (!this.pendingDisprove || !removedPlayer) {
      return;
    }

    const wasSuggester =
      this.pendingDisprove.suggesterId === removedPlayer.id;

    const wasResponder =
      this.pendingDisprove.responderId === removedPlayer.id;

    // If the suggester left, the suggestion no longer matters.
    if (wasSuggester) {
      this.pendingDisprove = null;
      this.lastSuggestion = null;
      return;
    }

    // If the current responder left, continue looking for another player.
    if (wasResponder) {
      console.log(
        `${removedPlayer.character} disconnected while needing to disprove. Looking for next responder...`
      );

      this.pendingDisprove.responderId = null;
      this.pendingDisprove.responderCharacter = null;
      this.pendingDisprove.matchingCards = [];

      this.triggerDisprove();
    }
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

    if (
      !player ||
      player.id !== this.currentPlayerId ||
      player.moved ||
      this.gameOver ||
      this.pendingDisprove
    ) {
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

    if (
      !player ||
      player.id !== this.currentPlayerId ||
      player.suggested ||
      this.gameOver ||
      this.pendingDisprove
    ) {
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
    return false;
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

    if (
      !player ||
      player.id !== this.currentPlayerId ||
      player.eliminated ||
      this.gameOver ||
      this.pendingDisprove
    ) {
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

    if (!player || player.id !== this.currentPlayerId || this.gameOver||this.pendingDisprove) {
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
      roomCode: this.roomCode,
      currentPlayer: this.currentPlayerId,
      gameOver: this.gameOver,
      lastSuggestion: this.lastSuggestion,
      winner: this.winner,
      solution: this.gameOver ? this.solution : null,
      waitingForDisprove: !!this.pendingDisprove,
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
      roomCode: this.roomCode,
      currentPlayer: this.currentPlayerId,
      gameOver: this.gameOver,
      lastSuggestion: this.lastSuggestion,
      winner: this.winner,
      solution: this.gameOver ? this.solution : null,
      waitingForDisprove: !!this.pendingDisprove,
      ...extra
    };

    if (!this.io){
      console.error("Socekt.IO instance not initialized in Game");
      return;
    }

    this.io.to(this.roomCode).emit("GAME_STATE_UPDATE", state);

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