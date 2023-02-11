/** html5 DOM expected by xogame:

    #reset-game                             // "configure players" control
    #start-game                             // "start new game" control
    #players[.configure]                     // .configure if players configuring is allowed
    #player-N[.current_player][.won]         // N={1,2} .current_player if PlayerN's turn, 
                                            // .won if PlayerN has won last game    
    #player-N-score[value="<player score>"] // N={1,2} 
    #games-count[value=<games played>]
    #player-N-T[.selected]                     // N={1,2}, T={human,bot1,bot2,bot3}, 
                                            // .selected if T plays for PlayerN 
    #game_winner[value="W"]                 // W=player-N, N={1,2} if PlayerN has won last game, 
                                            // W=draw if it's draw, 
                                            // W=waiting if gamefield expects input    
    #board[.disabled]                         // .disabled if gamefield inactive (doesn't expect input)
    #cellN.xocell[data-marker="M"][.won]    // N={0..8} gamefield cell controls
                                            // M={0( ),1(X),2(0)} 
                                            // .won if cell's line has won last game
*/

(function( xoutil, undefined ) {
    let originalDom = null;
    
    function updateSelector( selector, value ) {
        let backup = {};
        let elem = document.querySelector(selector);
        if( elem ) {
            if ( typeof value === 'object' ) {
                let attrs = {};
                for( let prop in value ) {
                    attrs[ prop ] = elem.getAttribute( prop );
                    elem.setAttribute( prop, value[ prop ] );  
                }
                backup = attrs;
            } else {
                backup = elem.innerHTML;
                elem.innerHTML = value;
            }
        }
        return backup;
    }

    xoutil.updateDom = function( table ) {
        let prevDom = {};
        for( let selector in table ) {
            prevDom[selector] = updateSelector( selector, table[selector] );
        }
        originalDom = originalDom || prevDom;
    }

    xoutil.restoreDom = function() {
        if (originalDom) 
            xoutil.updateDom( originalDom );
    }

    class Elem {
        constructor(id, name) { this.id = id; this.name = name; }
        _elem(f, ...args) { 
            let e = document.getElementById(this.id); 
            return e ? f(e, ...args) : undefined; 
        }
    }
    
    class Property extends Elem {
        get() { return this._elem(e => e ? e.classList.contains(this.name) : false); }
        set(v) { return this._elem((e,v) => {
            if (v) 
                e.classList.add(this.name); 
            else 
                e.classList.remove(this.name);
        }, v); }
    }
    
    class Attribute extends Elem  {
        get() { return this._elem(e => e ? e.getAttribute(this.name) : false); }
        set(v) { return this._elem((e,v) => {
            if (v==null) 
                e.removeAttribute(this.name); 
            else 
                e.setAttribute(this.name,v);
        }, v); }
        incr(v = 1) { return this._elem((e,v) => {
            let value = e.getAttribute( this.name );
            if (value == null) 
                value = 0;
            e.setAttribute( this.name, Number(value) + v);
        }, v); }
    }
    
    class Event extends Elem  {
        bind(handler) { return this._elem( (e,handler) => {
            if (e.addEventListener) { 
                let name = this.name ? this.name : e.getAttribute('data-event');
                name = name ? name : "click";
                e.addEventListener(name, handler);
            }
        }, handler); }
    }
    
    xoutil.property     = function( id, name ) { return new Property(id, name); }    
    xoutil.attribute    = function( id, name ) { return new Attribute(id, name); }    
    xoutil.event        = function( id, name ) { return new Event(id, name); }
    
    xoutil.randomItem = function( array ) {
        return array[ Math.floor(Math.random() * array.length) ];
    }
}(window.xoutil = window.xoutil || {}));

(function( xogame, undefined ) {
    "use strict";
    const PlayerType = {HUMAN: "human", BOT1: "bot1", BOT2: "bot2", BOT3: "bot3"};
    let players = [ {type:PlayerType.HUMAN, score:0, id:1}, {type:PlayerType.BOT1, score:0, id:2} ];
    let firstPlayer = players[0];
    let currentPlayer;
    let playerWon;

    const Cell = {EMPTY:0, X:1, O:2};
    let cells = new Array(9); 
    let cellsWon;

    let lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
    let linesAtCell = new Array(9);
    let botWaiter;
    let botTimeout = 500;
    let nodes = {};
    let symmetries = [
        [ 2,1,0,5,4,3,8,7,6 ],
        [ 6,7,8,3,4,5,0,1,2 ],
        [ 8,5,2,7,4,1,6,3,0 ],
        [ 0,3,6,1,4,7,2,5,8 ],
        [ 8,7,6,5,4,3,2,1,0 ],
        [ 2,5,8,1,4,7,0,3,6 ],
        [ 6,3,0,7,4,1,8,5,2 ] ];
    
    let dom = {        
        lang_en:    xoutil.event("lang-en"),
        lang_ru:    xoutil.event("lang-ru"),
        reset_game: xoutil.event("reset-game"),
        start_game: xoutil.event("start-game"),
        player: function(player) { 
            let tag = "player-"+player.id;
            return {
                wins: xoutil.property(tag, "won"),
                turn: xoutil.property(tag, "current_player"),
                score: xoutil.attribute(tag+"-score", "value"),
                type_selected: t => xoutil.property(tag+"-"+t, "selected"),
                select_type: t => xoutil.event(tag+"-"+t)
            }
        },
        configure:      xoutil.property("players", "configure"),
        winner:         xoutil.attribute("game-winner", "value"),
        games_count:    xoutil.attribute("games-count", "value"),        
        board_disabled: xoutil.property("board", "disabled"),
        cell: function(cell) { 
            let tag = 'cell'+cell;
            return {
                event: xoutil.event(tag), 
                value: xoutil.attribute(tag, "data-marker"),
                wins:  xoutil.property(tag, "won")
            } 
        }        
    }    
    
    xogame.resetGame = function() {  
        if (dom.configure.get()) {
            resetCells();
        } else {
            resetCells();
            dom.configure.set(true);
        }
    }

    xogame.startGame = function() {
        resetCells();
        dom.configure.set(false);
        setCurrentPlayer( firstPlayer );
    }

    xogame.init = function() {
        dom.lang_en.bind( function() { xoutil.restoreDom() } );
        dom.lang_ru.bind( function() { xoutil.updateDom( ruDom ) } );
        dom.reset_game.bind( xogame.resetGame );
        dom.start_game.bind( xogame.startGame );
        for(let player of players) {    
            for(let type of Object.values(PlayerType)) {                
                dom.player(player).select_type(type).bind( onSelectPlayerType.bind(this, player, type) );
            }
        }
        updatePlayerTypes();
        resetCells();
        for(let cell of cells.keys()) 
        {
            dom.cell(cell).event.bind( onClickCell.bind(this, cell) );
            linesAtCell[cell] = [];        
        }
        for(let line of lines) for(let cell of line) {
            linesAtCell[cell].push( line );        
        }
        buildBranch( cells, 1, listFreeCells(cells) );
    }
    
    /** private section */

    function resetCells() {
        window.clearTimeout(botWaiter);
        cells.fill(Cell.EMPTY);
        cells.forEach( (id,cell) => dom.cell(cell).value.set(id) );
        if (playerWon) {
            dom.player(playerWon).wins.set(false);
            playerWon = undefined;
        }
        if (cellsWon) {
            cellsWon.forEach(cell => dom.cell(cell).wins.set(false) );
            cellsWon = undefined;
        }
        dom.winner.set(null);
        setCurrentPlayer(undefined);    
    }

    function onClickCell(id) {
        if (currentPlayer && currentPlayer.type == PlayerType.HUMAN && cells[id] == Cell.EMPTY) {
            processTurn(id);        
        }
    }

    function onSelectPlayerType(player, type) {
        if (!currentPlayer) {
            player.type = type;
            updatePlayerTypes();        
        }
    }

    function updatePlayerTypes() {
        firstPlayer = players[0];
        dom.games_count.set(0);
        for(let player of players) {
            let pinfo = dom.player(player);
            pinfo.score.set(0);
            for(let t of Object.values(PlayerType)) {
                pinfo.type_selected(t).set(player.type == t);
            }
        }
    }

    function isUniformLine(cells, line) {
        return (cells[line[0]] == cells[line[1]]) && (cells[line[1]] == cells[line[2]]); 
    }

    function cellFillsLine(cells, cell) {
        for( let line of linesAtCell[cell] ) {
            if (isUniformLine( cells, line ))
                return line;
        }
        return null;
    }

    function setCurrentPlayer(newPlayer) {
        currentPlayer = newPlayer;
        for(let player of players) {
            dom.player(player).turn.set(currentPlayer == player);
        }
        let isHuman = (currentPlayer && currentPlayer.type == PlayerType.HUMAN);
        dom.board_disabled.set(!isHuman);
        dom.configure.set(false);
        if (isHuman) {
            dom.winner.set('waiting');
        } else if (currentPlayer) {
              dom.winner.set(null);
            botTurn();
        }
    }

    function nextPlayerId(id) { return id^3; }
    
    function getNextPlayer( player ) { return players[ nextPlayerId(player.id)-1 ];    }

    function processTurn(cell) {
        cells[cell] = currentPlayer.id;
        dom.cell(cell).value.set(currentPlayer.id);
        let id = "player-"+currentPlayer.id;
        cellsWon = cellFillsLine(cells, cell);
        if (cellsWon) {
            playerWon = currentPlayer;
            dom.games_count.incr();
            let pinfo = dom.player(playerWon);
            pinfo.score.incr();
            pinfo.wins.set(true);
            cellsWon.forEach(cell => dom.cell(cell).wins.set(true) );
               dom.winner.set(id);
        } else if (!cells.includes(Cell.EMPTY)) {
            dom.games_count.incr();
               dom.winner.set("draw");
        } else {
            setCurrentPlayer(getNextPlayer(currentPlayer)); 
            return;
        }
        setCurrentPlayer(undefined);
        firstPlayer = getNextPlayer(firstPlayer);
    }

    function listFreeCells(cells) {
        let indices = [];
        for(let i of cells.keys()) {
            if (cells[i]==Cell.EMPTY) 
                indices.push(i);
        }
        return indices;
    }

    function bot1Turn() {
        return xoutil.randomItem(listFreeCells(cells));
    }

    function bot2Turn() {    
        let freeCells = listFreeCells(cells);
        let cs = cells;
        for( let c of freeCells ) { // find win
            cs[c] = currentPlayer.id;
            if (cellFillsLine( cs, c ))
                return c;
            cs[c] = Cell.EMPTY;
        }
        let enemyid = nextPlayerId(currentPlayer.id); 
        {
            for( let c of freeCells ) { // find fail
                cs[c] = enemyid;
                if (cellFillsLine( cs, c ))
                    return c;
                cs[c] = Cell.EMPTY;
            }
        }
        return xoutil.randomItem(freeCells);
    }

    let botEngines = { "bot1":bot1Turn, "bot2":bot2Turn, "bot3":bot3Turn };
    function processBotTurn() {
        return processTurn( botEngines[ currentPlayer.type ]() );
    }
    
    function botTurn() {
        botWaiter = setTimeout( processBotTurn.bind(this), botTimeout );
    }

    function bot3Turn() {
        let bestCells = [];
        let rank = -2;
        let ncells = firstPlayer.id > 1 ? cells.map(c => c > 0 ? nextPlayerId(c) : c) : cells.slice();
        let id = firstPlayer.id > 1 ? nextPlayerId(currentPlayer.id) : currentPlayer.id;
        for( let i of listFreeCells(ncells) ) {
            ncells[ i ] = id;
            let node = getSymNode( ncells );
            let nodeRank = nodes[node];
            if (nodeRank > rank) {
                rank = nodeRank;
                bestCells = [ i ];
            } else if (nodeRank == rank) {
                bestCells.push( i );
            } 
            ncells[ i ] = Cell.EMPTY;
        }
        return xoutil.randomItem( bestCells );
    }
    
    function getSymNode(cells) {
        let node = cells.join();
        if (nodes[node]!==undefined) 
            return node;
        for( let sym of symmetries ) {
            node = sym.map(c => cells[c]).join();
            if (nodes[node]!==undefined) 
                return node;
        }
        return null;
    }
    
    function buildBranch( cells, playerid, freeCells ) {
        let rank = -2;
        for( let i in freeCells ) {
            let c = freeCells[ i ];
            if (c === undefined) continue;
            cells[c] = playerid;
            freeCells[i] = undefined;
            let nextRank = buildNode( cells, c, freeCells );
            freeCells[i] = c;
            cells[c] = Cell.EMPTY;
            if (nextRank > rank) 
                rank = nextRank;                    
        }
        if (rank == -2) rank = 0;    
        return rank;
    }
    
    function buildNode( cells, focusCell, freeCells ) {
        let rank;
        let node = getSymNode(cells);
        if (node!==null) 
            rank = nodes[ node ];
        else {
            if (cellFillsLine(cells, focusCell)) {
                rank = 1.0;                
            } else {
                rank = buildBranch( cells, nextPlayerId( cells[focusCell] ), freeCells ) / (-2.0);
            }
            nodes[ cells.join() ] = rank;
        }
        return rank;
    }
    
}(window.xogame = window.xogame || {}));

window.onload = function() {
    window.xogame.init();
}


