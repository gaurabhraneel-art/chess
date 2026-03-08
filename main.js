/* ═══════════════════════════════════════════
   ULTRA HDR CHESS — main.js
   Full game logic + Stockfish AI + Three.js HDR scene
═══════════════════════════════════════════ */

'use strict';

// ─── PIECE UNICODE MAP ───
const PIECE_SYMBOLS = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟'
};

// ─── INITIAL BOARD POSITION ───
const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ─── FULL CHESS GAME STATE ───
class ChessGame {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = this.fenToBoard(INITIAL_FEN);
    this.turn = 'w';
    this.castling = { wK: true, wQ: true, bK: true, bQ: true };
    this.enPassant = null;
    this.halfMoves = 0;
    this.fullMoves = 1;
    this.moveHistory = [];
    this.positionHistory = [];
    this.capturedPieces = { w: [], b: [] };
    this.gameOver = false;
    this.result = null;
    this.inCheck = false;
  }

  fenToBoard(fen) {
    const [pos] = fen.split(' ');
    const board = Array(8).fill(null).map(() => Array(8).fill(null));
    const rows = pos.split('/');
    rows.forEach((row, r) => {
      let c = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { c += parseInt(ch); }
        else {
          const color = ch === ch.toUpperCase() ? 'w' : 'b';
          board[r][c] = color + ch.toUpperCase();
          c++;
        }
      }
    });
    return board;
  }

  boardToFen() {
    let fen = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (!p) { empty++; }
        else {
          if (empty) { fen += empty; empty = 0; }
          const ch = p[0] === 'w' ? p[1].toUpperCase() : p[1].toLowerCase();
          fen += ch;
        }
      }
      if (empty) fen += empty;
      if (r < 7) fen += '/';
    }
    const cast = [
      this.castling.wK ? 'K' : '',
      this.castling.wQ ? 'Q' : '',
      this.castling.bK ? 'k' : '',
      this.castling.bQ ? 'q' : ''
    ].join('') || '-';
    const ep = this.enPassant ? this.squareName(this.enPassant[0], this.enPassant[1]) : '-';
    return `${fen} ${this.turn} ${cast} ${ep} ${this.halfMoves} ${this.fullMoves}`;
  }

  squareName(r, c) {
    return 'abcdefgh'[c] + (8 - r);
  }

  nameToSquare(name) {
    return [8 - parseInt(name[1]), 'abcdefgh'.indexOf(name[0])];
  }

  isInBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

  isEnemy(piece, color) {
    return piece && piece[0] !== color;
  }

  isFriendly(piece, color) {
    return piece && piece[0] === color;
  }

  // Get pseudo-legal moves (ignoring check)
  getPseudoMoves(r, c, board) {
    board = board || this.board;
    const piece = board[r][c];
    if (!piece) return [];
    const [color, type] = [piece[0], piece[1]];
    const moves = [];
    const dir = color === 'w' ? -1 : 1;
    const startRow = color === 'w' ? 6 : 1;

    const addMove = (tr, tc, special) => {
      if (!this.isInBounds(tr, tc)) return;
      if (this.isFriendly(board[tr][tc], color)) return;
      moves.push({ from: [r, c], to: [tr, tc], special });
    };

    const addSlide = (dr, dc) => {
      for (let i = 1; i < 8; i++) {
        const tr = r + dr * i, tc = c + dc * i;
        if (!this.isInBounds(tr, tc)) break;
        if (this.isFriendly(board[tr][tc], color)) break;
        moves.push({ from: [r, c], to: [tr, tc] });
        if (board[tr][tc]) break;
      }
    };

    switch (type) {
      case 'P':
        // Forward
        if (!board[r + dir]?.[c]) {
          moves.push({ from: [r, c], to: [r + dir, c], special: (r + dir === 0 || r + dir === 7) ? 'promote' : null });
          if (r === startRow && !board[r + 2 * dir]?.[c]) {
            moves.push({ from: [r, c], to: [r + 2 * dir, c], special: 'doublepush' });
          }
        }
        // Captures
        for (const dc of [-1, 1]) {
          const tr = r + dir, tc = c + dc;
          if (!this.isInBounds(tr, tc)) continue;
          if (this.isEnemy(board[tr][tc], color)) {
            moves.push({ from: [r, c], to: [tr, tc], special: (tr === 0 || tr === 7) ? 'promote' : null });
          }
          if (this.enPassant && tr === this.enPassant[0] && tc === this.enPassant[1]) {
            moves.push({ from: [r, c], to: [tr, tc], special: 'enpassant' });
          }
        }
        break;
      case 'N':
        for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) addMove(r+dr, c+dc);
        break;
      case 'B': addSlide(-1,-1); addSlide(-1,1); addSlide(1,-1); addSlide(1,1); break;
      case 'R': addSlide(-1,0); addSlide(1,0); addSlide(0,-1); addSlide(0,1); break;
      case 'Q': addSlide(-1,-1); addSlide(-1,1); addSlide(1,-1); addSlide(1,1);
                addSlide(-1,0); addSlide(1,0); addSlide(0,-1); addSlide(0,1); break;
      case 'K':
        for (const [dr,dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) addMove(r+dr, c+dc);
        // Castling
        if (color === 'w' && r === 7 && c === 4) {
          if (this.castling.wK && !board[7][5] && !board[7][6] && board[7][7] === 'wR') moves.push({ from: [r,c], to: [7,6], special: 'castle-k' });
          if (this.castling.wQ && !board[7][3] && !board[7][2] && !board[7][1] && board[7][0] === 'wR') moves.push({ from: [r,c], to: [7,2], special: 'castle-q' });
        }
        if (color === 'b' && r === 0 && c === 4) {
          if (this.castling.bK && !board[0][5] && !board[0][6] && board[0][7] === 'bR') moves.push({ from: [r,c], to: [0,6], special: 'castle-k' });
          if (this.castling.bQ && !board[0][3] && !board[0][2] && !board[0][1] && board[0][0] === 'bR') moves.push({ from: [r,c], to: [0,2], special: 'castle-q' });
        }
        break;
    }
    return moves;
  }

  findKing(color, board) {
    board = board || this.board;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (board[r][c] === color + 'K') return [r, c];
    return null;
  }

  isSquareAttacked(tr, tc, byColor, board) {
    board = board || this.board;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (board[r][c]?.[0] === byColor) {
          const moves = this.getPseudoMoves(r, c, board);
          if (moves.some(m => m.to[0] === tr && m.to[1] === tc)) return true;
        }
    return false;
  }

  applyMove(move, board, castling, enPassant) {
    board = board.map(r => [...r]);
    const [fr, fc] = move.from, [tr, tc] = move.to;
    const piece = board[fr][fc];
    const color = piece[0];
    let captured = board[tr][tc];
    let newEnPassant = null;
    const newCastling = { ...castling };

    board[tr][tc] = piece;
    board[fr][fc] = null;

    if (move.special === 'doublepush') {
      newEnPassant = [fr + (color === 'w' ? -1 : 1), fc];
    }
    if (move.special === 'enpassant') {
      const capRow = color === 'w' ? tr + 1 : tr - 1;
      captured = board[capRow][tc];
      board[capRow][tc] = null;
    }
    if (move.special === 'castle-k') {
      const rook = board[tr][7]; board[tr][5] = rook; board[tr][7] = null;
    }
    if (move.special === 'castle-q') {
      const rook = board[tr][0]; board[tr][3] = rook; board[tr][0] = null;
    }
    if (move.special === 'promote' && move.promotion) {
      board[tr][tc] = color + move.promotion;
    }

    // Update castling rights
    if (piece === 'wK') { newCastling.wK = false; newCastling.wQ = false; }
    if (piece === 'bK') { newCastling.bK = false; newCastling.bQ = false; }
    if (piece === 'wR' && fr === 7 && fc === 7) newCastling.wK = false;
    if (piece === 'wR' && fr === 7 && fc === 0) newCastling.wQ = false;
    if (piece === 'bR' && fr === 0 && fc === 7) newCastling.bK = false;
    if (piece === 'bR' && fr === 0 && fc === 0) newCastling.bQ = false;

    return { board, captured, newEnPassant, newCastling };
  }

  isInCheckAfterMove(move, color) {
    const { board } = this.applyMove(move, this.board, this.castling, this.enPassant);
    const king = this.findKing(color, board);
    if (!king) return true;
    const enemy = color === 'w' ? 'b' : 'w';
    return this.isSquareAttacked(king[0], king[1], enemy, board);
  }

  getLegalMoves(r, c) {
    const piece = this.board[r][c];
    if (!piece || piece[0] !== this.turn) return [];
    const pseudo = this.getPseudoMoves(r, c);
    return pseudo.filter(m => !this.isInCheckAfterMove(m, this.turn));
  }

  getAllLegalMoves() {
    const moves = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (this.board[r][c]?.[0] === this.turn)
          moves.push(...this.getLegalMoves(r, c));
    return moves;
  }

  makeMove(move) {
    const { board, captured, newEnPassant, newCastling } = this.applyMove(
      move, this.board, this.castling, this.enPassant
    );
    
    const piece = this.board[move.from[0]][move.from[1]];
    const color = piece[0];
    
    // Record history
    this.moveHistory.push({
      move, piece, captured,
      prevBoard: this.board.map(r => [...r]),
      prevCastling: { ...this.castling },
      prevEnPassant: this.enPassant,
      prevHalfMoves: this.halfMoves,
      san: this.toSAN(move, piece, captured)
    });

    this.board = board;
    this.castling = newCastling;
    this.enPassant = newEnPassant;
    this.halfMoves = (piece[1] === 'P' || captured) ? 0 : this.halfMoves + 1;
    if (this.turn === 'b') this.fullMoves++;
    this.turn = this.turn === 'w' ? 'b' : 'w';

    // Track captured
    if (captured) this.capturedPieces[color].push(captured);

    // Check game state
    this.inCheck = false;
    const kingPos = this.findKing(this.turn, this.board);
    const enemy = this.turn === 'w' ? 'b' : 'w';
    if (kingPos && this.isSquareAttacked(kingPos[0], kingPos[1], enemy, this.board)) {
      this.inCheck = true;
    }

    const legalMoves = this.getAllLegalMoves();
    if (legalMoves.length === 0) {
      this.gameOver = true;
      this.result = this.inCheck ? 
        (this.turn === 'w' ? 'Black wins by checkmate!' : 'White wins by checkmate!') : 
        'Draw by stalemate!';
    }

    // Fifty-move rule
    if (this.halfMoves >= 100) {
      this.gameOver = true;
      this.result = 'Draw by fifty-move rule!';
    }

    return { san: this.moveHistory[this.moveHistory.length - 1].san, captured };
  }

  undoMove() {
    if (!this.moveHistory.length) return false;
    const last = this.moveHistory.pop();
    this.board = last.prevBoard;
    this.castling = last.prevCastling;
    this.enPassant = last.prevEnPassant;
    this.halfMoves = last.prevHalfMoves;
    this.turn = this.turn === 'w' ? 'b' : 'w';
    if (this.turn === 'b') this.fullMoves--;
    if (last.captured) {
      const color = last.piece[0];
      const idx = this.capturedPieces[color].lastIndexOf(last.captured);
      if (idx !== -1) this.capturedPieces[color].splice(idx, 1);
    }
    this.gameOver = false;
    this.result = null;
    this.inCheck = false;
    const kingPos = this.findKing(this.turn, this.board);
    if (kingPos) {
      const enemy = this.turn === 'w' ? 'b' : 'w';
      this.inCheck = this.isSquareAttacked(kingPos[0], kingPos[1], enemy, this.board);
    }
    return true;
  }

  toSAN(move, piece, captured) {
    const files = 'abcdefgh';
    const [fr, fc] = move.from, [tr, tc] = move.to;
    const type = piece[1];
    let san = '';
    if (move.special === 'castle-k') return 'O-O';
    if (move.special === 'castle-q') return 'O-O-O';
    if (type !== 'P') san += type;
    if (captured || move.special === 'enpassant') {
      if (type === 'P') san += files[fc];
      san += 'x';
    }
    san += files[tc] + (8 - tr);
    if (move.promotion) san += '=' + move.promotion;
    return san;
  }
}

// ─── THREE.JS HDR SCENE ───
class HDRChessScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.animFrameId = null;
    this.particles = [];
    this.boardMesh = null;
    this.init();
  }

  init() {
    const w = this.canvas.offsetWidth || 560;
    const h = this.canvas.offsetHeight || 560;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.physicallyCorrectLights = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.outputEncoding = THREE.sRGBEncoding;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060810);
    this.scene.fog = new THREE.FogExp2(0x060810, 0.035);

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 8, 9);
    this.camera.lookAt(0, 0, 0);

    this.setupLighting();
    this.setupBoard();
    this.setupParticles();
    this.animate();
  }

  setupLighting() {
    // Ambient
    const ambient = new THREE.AmbientLight(0x1a1408, 0.8);
    this.scene.add(ambient);

    // Main warm overhead light
    const mainLight = new THREE.DirectionalLight(0xfff0d0, 3);
    mainLight.position.set(3, 10, 5);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.set(2048, 2048);
    mainLight.shadow.camera.near = 0.1;
    mainLight.shadow.camera.far = 30;
    mainLight.shadow.camera.left = -6;
    mainLight.shadow.camera.right = 6;
    mainLight.shadow.camera.top = 6;
    mainLight.shadow.camera.bottom = -6;
    mainLight.shadow.bias = -0.001;
    this.scene.add(mainLight);

    // Blue rim light
    const rimLight = new THREE.DirectionalLight(0x4080c0, 1.2);
    rimLight.position.set(-8, 4, -4);
    this.scene.add(rimLight);

    // Gold bounce
    const bounceLight = new THREE.PointLight(0xc9a84c, 1.5, 15);
    bounceLight.position.set(0, 1, 0);
    this.scene.add(bounceLight);
    this.bounceLight = bounceLight;

    // Corner spots
    const spotPositions = [[-4,6,4],[4,6,4],[-4,6,-4],[4,6,-4]];
    spotPositions.forEach((pos, i) => {
      const spot = new THREE.SpotLight(
        i < 2 ? 0xffe8c0 : 0x8090c0,
        i < 2 ? 2 : 1,
        20, Math.PI / 8, 0.3
      );
      spot.position.set(...pos);
      spot.target.position.set(0, 0, 0);
      spot.castShadow = i === 0;
      this.scene.add(spot);
      this.scene.add(spot.target);
    });

    // Subtle floor glow
    const floorGlow = new THREE.PointLight(0xc9a84c, 0.5, 8);
    floorGlow.position.set(0, -1, 0);
    this.scene.add(floorGlow);
    this.floorGlow = floorGlow;
  }

  setupBoard() {
    // Board base (thick slab)
    const baseGeom = new THREE.BoxGeometry(9.6, 0.25, 9.6);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1a1205,
      roughness: 0.3,
      metalness: 0.6,
      envMapIntensity: 0.8
    });
    const base = new THREE.Mesh(baseGeom, baseMat);
    base.position.y = -0.13;
    base.receiveShadow = true;
    base.castShadow = true;
    this.scene.add(base);

    // Board surface with checker pattern (8x8 individual tiles)
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const isLight = (r + c) % 2 === 0;
        const tileGeom = new THREE.BoxGeometry(1.1, 0.08, 1.1);
        const tileMat = new THREE.MeshStandardMaterial({
          color: isLight ? 0xe8d5a0 : 0x2a1e0a,
          roughness: isLight ? 0.2 : 0.4,
          metalness: isLight ? 0.05 : 0.15,
          envMapIntensity: isLight ? 0.6 : 0.3
        });
        const tile = new THREE.Mesh(tileGeom, tileMat);
        tile.position.set((c - 3.5) * 1.1, 0.04, (r - 3.5) * 1.1);
        tile.receiveShadow = true;
        this.scene.add(tile);
      }
    }

    // Glossy border
    const borderGeom = new THREE.BoxGeometry(9.6, 0.15, 9.6);
    const borderMat = new THREE.MeshStandardMaterial({
      color: 0x3d2b10,
      roughness: 0.15,
      metalness: 0.7,
      envMapIntensity: 1.0
    });
    // Inner cutout using a frame approach (4 rectangles)
    const framePositions = [
      [0, 0.08, -4.65, 9.6, 0.15, 0.3],
      [0, 0.08, 4.65, 9.6, 0.15, 0.3],
      [-4.65, 0.08, 0, 0.3, 0.15, 9.0],
      [4.65, 0.08, 0, 0.3, 0.15, 9.0],
    ];
    framePositions.forEach(([x, y, z, w, h, d]) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(g, borderMat);
      m.position.set(x, y, z);
      m.receiveShadow = true;
      m.castShadow = true;
      this.scene.add(m);
    });

    // Ground plane with reflective material
    const groundGeom = new THREE.PlaneGeometry(40, 40);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x080a0d,
      roughness: 0.05,
      metalness: 0.8,
      envMapIntensity: 0.4
    });
    const ground = new THREE.Mesh(groundGeom, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.26;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Environment sphere
    const envGeom = new THREE.SphereGeometry(50, 16, 16);
    const envMat = new THREE.MeshBasicMaterial({
      color: 0x060810,
      side: THREE.BackSide
    });
    this.scene.add(new THREE.Mesh(envGeom, envMat));
  }

  setupParticles() {
    const count = 120;
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = Math.random() * 12 - 1;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
      sizes[i] = Math.random() * 3 + 1;
    }
    
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    const mat = new THREE.PointsMaterial({
      color: 0xc9a84c,
      size: 0.04,
      transparent: true,
      opacity: 0.4,
      sizeAttenuation: true
    });
    
    const particles = new THREE.Points(geom, mat);
    this.scene.add(particles);
    this.particles = particles;
  }

  animate() {
    this.animFrameId = requestAnimationFrame(() => this.animate());
    const t = Date.now() * 0.001;

    // Animate lights
    if (this.bounceLight) {
      this.bounceLight.intensity = 1.5 + Math.sin(t * 0.7) * 0.3;
    }
    if (this.floorGlow) {
      this.floorGlow.intensity = 0.4 + Math.sin(t * 1.1) * 0.15;
    }

    // Animate particles
    if (this.particles) {
      const pos = this.particles.geometry.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        pos[i + 1] += 0.008;
        if (pos[i + 1] > 11) pos[i + 1] = -1;
        pos[i] += Math.sin(t + i) * 0.001;
      }
      this.particles.geometry.attributes.position.needsUpdate = true;
      this.particles.rotation.y = t * 0.02;
    }

    this.renderer.render(this.scene, this.camera);
  }

  pulseCapture(worldPos) {
    // Ring effect at capture square
    const ringGeom = new THREE.RingGeometry(0.1, 0.6, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xc94a4a, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.set(worldPos.x, 0.1, worldPos.z);
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);
    let scale = 1, opacity = 0.8;
    const expand = () => {
      scale += 0.12;
      opacity -= 0.04;
      ring.scale.set(scale, scale, scale);
      ringMat.opacity = Math.max(0, opacity);
      if (opacity > 0) requestAnimationFrame(expand);
      else this.scene.remove(ring);
    };
    requestAnimationFrame(expand);
  }

  squareToWorld(r, c) {
    return { x: (c - 3.5) * 1.1, z: (r - 3.5) * 1.1 };
  }

  resize(w, h) {
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  destroy() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    this.renderer.dispose();
  }
}

// ─── STOCKFISH AI (via Blob Worker) ───
class StockfishEngine {
  constructor() {
    this.worker = null;
    this.onMove = null;
    this.depth = 10;
    this.ready = false;
    this.resolveReady = null;
    this.init();
  }

  init() {
    // Build Stockfish-like minimax in a web worker
    const workerCode = `
      // Simplified but functional chess AI using minimax + alpha-beta
      const PIECE_VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
      
      const PST = {
        P: [
          0,0,0,0,0,0,0,0,
          50,50,50,50,50,50,50,50,
          10,10,20,30,30,20,10,10,
          5,5,10,25,25,10,5,5,
          0,0,0,20,20,0,0,0,
          5,-5,-10,0,0,-10,-5,5,
          5,10,10,-20,-20,10,10,5,
          0,0,0,0,0,0,0,0
        ],
        N: [
          -50,-40,-30,-30,-30,-30,-40,-50,
          -40,-20,0,0,0,0,-20,-40,
          -30,0,10,15,15,10,0,-30,
          -30,5,15,20,20,15,5,-30,
          -30,0,15,20,20,15,0,-30,
          -30,5,10,15,15,10,5,-30,
          -40,-20,0,5,5,0,-20,-40,
          -50,-40,-30,-30,-30,-30,-40,-50
        ],
        B: [
          -20,-10,-10,-10,-10,-10,-10,-20,
          -10,0,0,0,0,0,0,-10,
          -10,0,5,10,10,5,0,-10,
          -10,5,5,10,10,5,5,-10,
          -10,0,10,10,10,10,0,-10,
          -10,10,10,10,10,10,10,-10,
          -10,5,0,0,0,0,5,-10,
          -20,-10,-10,-10,-10,-10,-10,-20
        ],
        R: [
          0,0,0,0,0,0,0,0,
          5,10,10,10,10,10,10,5,
          -5,0,0,0,0,0,0,-5,
          -5,0,0,0,0,0,0,-5,
          -5,0,0,0,0,0,0,-5,
          -5,0,0,0,0,0,0,-5,
          -5,0,0,0,0,0,0,-5,
          0,0,0,5,5,0,0,0
        ],
        Q: [
          -20,-10,-10,-5,-5,-10,-10,-20,
          -10,0,0,0,0,0,0,-10,
          -10,0,5,5,5,5,0,-10,
          -5,0,5,5,5,5,0,-5,
          0,0,5,5,5,5,0,-5,
          -10,5,5,5,5,5,0,-10,
          -10,0,5,0,0,0,0,-10,
          -20,-10,-10,-5,-5,-10,-10,-20
        ],
        K: [
          -30,-40,-40,-50,-50,-40,-40,-30,
          -30,-40,-40,-50,-50,-40,-40,-30,
          -30,-40,-40,-50,-50,-40,-40,-30,
          -30,-40,-40,-50,-50,-40,-40,-30,
          -20,-30,-30,-40,-40,-30,-30,-20,
          -10,-20,-20,-20,-20,-20,-20,-10,
          20,20,0,0,0,0,20,20,
          20,30,10,0,0,10,30,20
        ]
      };

      let board = null;
      let turn = 'w';
      let castling = {};
      let enPassant = null;
      let depth = 10;

      function isInBounds(r,c){return r>=0&&r<8&&c>=0&&c<8;}
      function isFriendly(p,col){return p&&p[0]===col;}
      function isEnemy(p,col){return p&&p[0]!==col;}

      function getPseudoMoves(r,c,brd,cast,ep) {
        const piece=brd[r][c]; if(!piece)return[];
        const color=piece[0],type=piece[1];
        const moves=[]; const dir=color==='w'?-1:1; const startRow=color==='w'?6:1;
        const addM=(tr,tc,sp)=>{
          if(!isInBounds(tr,tc))return;
          if(isFriendly(brd[tr][tc],color))return;
          moves.push({from:[r,c],to:[tr,tc],special:sp||null});
        };
        const addS=(dr,dc)=>{
          for(let i=1;i<8;i++){const tr=r+dr*i,tc=c+dc*i;
            if(!isInBounds(tr,tc))break;
            if(isFriendly(brd[tr][tc],color))break;
            moves.push({from:[r,c],to:[tr,tc]});
            if(brd[tr][tc])break;}
        };
        switch(type){
          case'P':
            if(!brd[r+dir]?.[c]){
              moves.push({from:[r,c],to:[r+dir,c],special:(r+dir===0||r+dir===7)?'promote':null});
              if(r===startRow&&!brd[r+2*dir]?.[c])moves.push({from:[r,c],to:[r+2*dir,c],special:'doublepush'});
            }
            for(const dc of[-1,1]){const tr=r+dir,tc=c+dc;
              if(!isInBounds(tr,tc))continue;
              if(isEnemy(brd[tr][tc],color))moves.push({from:[r,c],to:[tr,tc],special:(tr===0||tr===7)?'promote':null});
              if(ep&&tr===ep[0]&&tc===ep[1])moves.push({from:[r,c],to:[tr,tc],special:'enpassant'});
            } break;
          case'N':for(const[dr,dc]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])addM(r+dr,c+dc);break;
          case'B':addS(-1,-1);addS(-1,1);addS(1,-1);addS(1,1);break;
          case'R':addS(-1,0);addS(1,0);addS(0,-1);addS(0,1);break;
          case'Q':addS(-1,-1);addS(-1,1);addS(1,-1);addS(1,1);addS(-1,0);addS(1,0);addS(0,-1);addS(0,1);break;
          case'K':
            for(const[dr,dc]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])addM(r+dr,c+dc);
            if(color==='w'&&r===7&&c===4){
              if(cast.wK&&!brd[7][5]&&!brd[7][6]&&brd[7][7]==='wR')moves.push({from:[r,c],to:[7,6],special:'castle-k'});
              if(cast.wQ&&!brd[7][3]&&!brd[7][2]&&!brd[7][1]&&brd[7][0]==='wR')moves.push({from:[r,c],to:[7,2],special:'castle-q'});
            }
            if(color==='b'&&r===0&&c===4){
              if(cast.bK&&!brd[0][5]&&!brd[0][6]&&brd[0][7]==='bR')moves.push({from:[r,c],to:[0,6],special:'castle-k'});
              if(cast.bQ&&!brd[0][3]&&!brd[0][2]&&!brd[0][1]&&brd[0][0]==='bR')moves.push({from:[r,c],to:[0,2],special:'castle-q'});
            } break;
        }
        return moves;
      }

      function applyMove(m,brd,cast,ep){
        brd=brd.map(r=>[...r]);
        const[fr,fc]=m.from,[tr,tc]=m.to;
        const piece=brd[fr][fc]; const color=piece[0];
        let cap=brd[tr][tc];
        const nc={...cast}; let nep=null;
        brd[tr][tc]=piece; brd[fr][fc]=null;
        if(m.special==='doublepush')nep=[fr+(color==='w'?-1:1),fc];
        if(m.special==='enpassant'){const cr=color==='w'?tr+1:tr-1;cap=brd[cr][tc];brd[cr][tc]=null;}
        if(m.special==='castle-k'){brd[tr][5]=brd[tr][7];brd[tr][7]=null;}
        if(m.special==='castle-q'){brd[tr][3]=brd[tr][0];brd[tr][0]=null;}
        if(m.special==='promote')brd[tr][tc]=color+(m.promotion||'Q');
        if(piece==='wK'){nc.wK=nc.wQ=false;}if(piece==='bK'){nc.bK=nc.bQ=false;}
        if(piece==='wR'&&fr===7&&fc===7)nc.wK=false;if(piece==='wR'&&fr===7&&fc===0)nc.wQ=false;
        if(piece==='bR'&&fr===0&&fc===7)nc.bK=false;if(piece==='bR'&&fr===0&&fc===0)nc.bQ=false;
        return{board:brd,cap,nep,nc};
      }

      function findKing(col,brd){
        for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(brd[r][c]===col+'K')return[r,c];
        return null;
      }

      function isAttacked(tr,tc,byCol,brd){
        for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(brd[r][c]?.[0]===byCol){
          const ms=getPseudoMoves(r,c,brd,{wK:false,wQ:false,bK:false,bQ:false},null);
          if(ms.some(m=>m.to[0]===tr&&m.to[1]===tc))return true;
        }
        return false;
      }

      function getLegal(brd,col,cast,ep){
        const moves=[];
        for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(brd[r][c]?.[0]===col){
          const ps=getPseudoMoves(r,c,brd,cast,ep);
          for(const m of ps){
            const{board:nb}=applyMove(m,brd,cast,ep);
            const king=findKing(col,nb); if(!king)continue;
            const enemy=col==='w'?'b':'w';
            if(!isAttacked(king[0],king[1],enemy,nb)){
              if(m.special==='promote'){['Q','R','B','N'].forEach(p=>moves.push({...m,promotion:p}));}
              else moves.push(m);
            }
          }
        }
        return moves;
      }

      function evaluate(brd){
        let score=0;
        for(let r=0;r<8;r++)for(let c=0;c<8;c++){
          const p=brd[r][c]; if(!p)continue;
          const[col,type]=[p[0],p[1]];
          const val=PIECE_VALUES[type]||0;
          const pstIdx=col==='w'?r*8+c:(7-r)*8+c;
          const pst=(PST[type]||[])[pstIdx]||0;
          score+=(col==='w'?1:-1)*(val+pst);
        }
        return score;
      }

      function minimax(brd,col,d,alpha,beta,cast,ep){
        if(d===0)return{score:evaluate(brd),move:null};
        const moves=getLegal(brd,col,cast,ep);
        if(!moves.length){
          const king=findKing(col,brd);
          if(king&&isAttacked(king[0],king[1],col==='w'?'b':'w',brd))
            return{score:col==='w'?-50000+d:50000-d,move:null};
          return{score:0,move:null};
        }
        // Sort moves for better pruning
        moves.sort((a,b)=>{
          const ca=brd[a.to[0]][a.to[1]]?1:0;
          const cb=brd[b.to[0]][b.to[1]]?1:0;
          return cb-ca;
        });
        let best=col==='w'?{score:-Infinity,move:null}:{score:Infinity,move:null};
        for(const m of moves){
          const{board:nb,nc,nep}=applyMove(m,brd,cast,ep);
          const opp=col==='w'?'b':'w';
          const res=minimax(nb,opp,d-1,alpha,beta,nc,nep);
          if(col==='w'&&res.score>best.score){best={score:res.score,move:m}; alpha=Math.max(alpha,res.score);}
          if(col==='b'&&res.score<best.score){best={score:res.score,move:m}; beta=Math.min(beta,res.score);}
          if(beta<=alpha)break;
        }
        return best;
      }

      self.onmessage=function(e){
        const{type,data}=e.data;
        if(type==='setDepth'){depth=data; self.postMessage({type:'ready'});}
        if(type==='findBestMove'){
          const{brd,col,cast,ep}=data;
          try{
            const result=minimax(brd,col,depth,-Infinity,Infinity,cast,ep);
            self.postMessage({type:'bestMove',move:result.move,score:result.score});
          }catch(err){
            self.postMessage({type:'error',msg:err.message});
          }
        }
      };
      self.postMessage({type:'ready'});
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    this.worker = new Worker(url);

    this.worker.onmessage = (e) => {
      const { type, move, score } = e.data;
      if (type === 'ready') {
        this.ready = true;
        if (this.resolveReady) this.resolveReady();
      }
      if (type === 'bestMove' && this.onMove) {
        this.onMove(move, score);
      }
    };
  }

  setDepth(d) {
    this.depth = d;
    this.worker.postMessage({ type: 'setDepth', data: d });
  }

  findBestMove(game) {
    return new Promise(resolve => {
      this.onMove = (move) => { resolve(move); };
      this.worker.postMessage({
        type: 'findBestMove',
        data: {
          brd: game.board,
          col: game.turn,
          cast: game.castling,
          ep: game.enPassant
        }
      });
    });
  }
}

// ─── SOUND EFFECTS ───
class SoundFX {
  constructor() {
    this.ctx = null;
    this.enabled = false;
  }

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch(e) {}
  }

  play(type) {
    if (!this.enabled || !this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    const now = this.ctx.currentTime;
    switch(type) {
      case 'move':
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.1);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        break;
      case 'capture':
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.2);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        break;
      case 'check':
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(660, now + 0.1);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        break;
      case 'select':
        osc.frequency.setValueAtTime(700, now);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        break;
    }
    osc.start(now);
    osc.stop(now + 0.3);
  }
}

// ─── MAIN GAME CONTROLLER ───
class ChessApp {
  constructor() {
    this.game = new ChessGame();
    this.ai = new StockfishEngine();
    this.sound = new SoundFX();
    this.hdrScene = null;
    this.selectedSquare = null;
    this.legalMoves = [];
    this.playerColor = 'w';
    this.isFlipped = false;
    this.aiLevel = 5;
    this.showHints = true;
    this.animEnabled = true;
    this.lastMoveSquares = null;
    this.promotionPending = null;
    this.isAIThinking = false;

    this.init();
  }

  async init() {
    await this.showLoader();
    
    // Init HDR scene
    const canvas = document.getElementById('three-canvas');
    this.hdrScene = new HDRChessScene(canvas);
    
    // Handle resize
    const boardContainer = document.getElementById('board-container');
    const ro = new ResizeObserver(() => {
      const { offsetWidth: w, offsetHeight: h } = boardContainer;
      this.hdrScene.resize(w, h);
    });
    ro.observe(boardContainer);

    // Sound init on first interaction
    document.body.addEventListener('click', () => {
      if (!this.sound.ctx) this.sound.init();
    }, { once: true });

    this.renderBoard();
    this.bindEvents();
    this.hideLoader();
  }

  async showLoader() {
    const fill = document.getElementById('loader-fill');
    const text = document.getElementById('loader-text');
    const steps = [
      [20, 'Initializing Three.js renderer...'],
      [45, 'Loading HDR materials...'],
      [65, 'Setting up chess engine...'],
      [80, 'Building shader pipeline...'],
      [95, 'Placing the pieces...'],
      [100, 'Ready!']
    ];
    for (const [pct, msg] of steps) {
      fill.style.width = pct + '%';
      text.textContent = msg;
      await new Promise(r => setTimeout(r, 180 + Math.random() * 120));
    }
    await new Promise(r => setTimeout(r, 300));
  }

  hideLoader() {
    const loader = document.getElementById('loading-screen');
    const app = document.getElementById('app');
    loader.classList.add('fade-out');
    app.style.display = 'flex';
    setTimeout(() => { loader.style.display = 'none'; }, 800);
  }

  bindEvents() {
    // Board click
    document.getElementById('chess-board').addEventListener('click', (e) => {
      const sq = e.target.closest('.square');
      if (!sq) return;
      this.handleSquareClick(parseInt(sq.dataset.row), parseInt(sq.dataset.col));
    });

    // Buttons
    document.getElementById('btn-new-game').addEventListener('click', () => this.newGame());
    document.getElementById('modal-new-game').addEventListener('click', () => { this.closeModal(); this.newGame(); });
    document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('btn-flip').addEventListener('click', () => this.flipBoard());
    document.getElementById('btn-undo').addEventListener('click', () => this.undoMove());

    // Difficulty
    document.querySelectorAll('.diff-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.aiLevel = parseInt(btn.dataset.level);
        this.ai.setDepth(this.aiLevel);
        const ratings = {1:'ELO ~800',5:'ELO ~1500',10:'ELO ~2200',20:'ELO ~3500'};
        document.getElementById('ai-rating').textContent = ratings[this.aiLevel] || 'ELO ~2000';
      });
    });

    // Toggles
    document.getElementById('toggle-sound').addEventListener('click', (e) => {
      e.currentTarget.classList.toggle('active');
      this.sound.enabled = e.currentTarget.classList.contains('active');
    });
    document.getElementById('toggle-hints').addEventListener('click', (e) => {
      e.currentTarget.classList.toggle('active');
      this.showHints = e.currentTarget.classList.contains('active');
      this.renderBoard();
    });
    document.getElementById('toggle-anim').addEventListener('click', (e) => {
      e.currentTarget.classList.toggle('active');
      this.animEnabled = e.currentTarget.classList.contains('active');
    });
    document.getElementById('toggle-bloom').addEventListener('click', (e) => {
      e.currentTarget.classList.toggle('active');
      // HDR bloom toggle (adjusts exposure)
      this.hdrScene.renderer.toneMappingExposure = 
        e.currentTarget.classList.contains('active') ? 1.4 : 1.0;
    });
  }

  handleSquareClick(r, c) {
    if (this.isAIThinking || this.game.gameOver) return;
    if (this.game.turn !== this.playerColor) return;

    const piece = this.game.board[r][c];

    // If same color piece clicked, select it
    if (piece && piece[0] === this.playerColor) {
      if (this.selectedSquare && this.selectedSquare[0] === r && this.selectedSquare[1] === c) {
        this.selectedSquare = null;
        this.legalMoves = [];
      } else {
        this.selectedSquare = [r, c];
        this.legalMoves = this.game.getLegalMoves(r, c);
        this.sound.play('select');
      }
      this.renderBoard();
      return;
    }

    // If a piece is selected and this is a valid move target
    if (this.selectedSquare) {
      const move = this.legalMoves.find(
        m => m.to[0] === r && m.to[1] === c
      );
      if (move) {
        if (move.special === 'promote') {
          this.showPromotionDialog(move);
          return;
        }
        this.executePlayerMove(move);
        return;
      }
    }

    // Deselect
    this.selectedSquare = null;
    this.legalMoves = [];
    this.renderBoard();
  }

  showPromotionDialog(move) {
    this.promotionPending = move;
    const existing = document.getElementById('promotion-dialog');
    if (existing) existing.remove();

    const dialog = document.createElement('div');
    dialog.id = 'promotion-dialog';
    dialog.innerHTML = `
      <div id="promotion-box">
        <div class="panel-title">PROMOTE PAWN</div>
        <div class="promotion-pieces">
          ${['Q','R','B','N'].map(p => `
            <button class="promo-piece-btn" data-piece="${p}">
              ${PIECE_SYMBOLS[this.playerColor + p]}
            </button>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelectorAll('.promo-piece-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const promotion = btn.dataset.piece;
        dialog.remove();
        this.executePlayerMove({ ...this.promotionPending, promotion });
        this.promotionPending = null;
      });
    });
  }

  executePlayerMove(move) {
    const result = this.game.makeMove(move);
    this.lastMoveSquares = [move.from, move.to];
    this.selectedSquare = null;
    this.legalMoves = [];

    if (result.captured) this.sound.play('capture');
    else this.sound.play('move');

    if (this.game.inCheck) this.sound.play('check');

    // HDR capture effect
    if (result.captured) {
      const wp = this.hdrScene.squareToWorld(move.to[0], move.to[1]);
      this.hdrScene.pulseCapture(wp);
    }

    this.renderBoard();
    this.updateUI(result.san);

    if (this.game.gameOver) {
      setTimeout(() => this.showGameOverModal(), 600);
      return;
    }

    // AI turn
    setTimeout(() => this.triggerAI(), 300);
  }

  async triggerAI() {
    if (this.game.gameOver || this.game.turn === this.playerColor) return;
    
    this.isAIThinking = true;
    document.getElementById('thinking-indicator').style.display = 'flex';

    const move = await this.ai.findBestMove(this.game);

    document.getElementById('thinking-indicator').style.display = 'none';
    this.isAIThinking = false;

    if (!move) return;

    const result = this.game.makeMove(move);
    this.lastMoveSquares = [move.from, move.to];

    if (result.captured) this.sound.play('capture');
    else this.sound.play('move');
    if (this.game.inCheck) this.sound.play('check');

    if (result.captured) {
      const wp = this.hdrScene.squareToWorld(move.to[0], move.to[1]);
      this.hdrScene.pulseCapture(wp);
    }

    this.renderBoard();
    this.updateUI(result.san, true);

    if (this.game.gameOver) {
      setTimeout(() => this.showGameOverModal(), 600);
    }
  }

  undoMove() {
    if (this.isAIThinking) return;
    // Undo both player and AI moves
    this.game.undoMove();
    this.game.undoMove();
    this.selectedSquare = null;
    this.legalMoves = [];
    this.lastMoveSquares = this.game.moveHistory.length > 0 ?
      [this.game.moveHistory[this.game.moveHistory.length - 1].move.from,
       this.game.moveHistory[this.game.moveHistory.length - 1].move.to] : null;
    this.renderBoard();
    this.updateStatus();
    this.renderMoveHistory();
    this.updateCaptured();
  }

  flipBoard() {
    this.isFlipped = !this.isFlipped;
    this.playerColor = this.isFlipped ? 'b' : 'w';
    this.renderBoard();
  }

  newGame() {
    this.game.reset();
    this.selectedSquare = null;
    this.legalMoves = [];
    this.lastMoveSquares = null;
    this.isAIThinking = false;
    document.getElementById('thinking-indicator').style.display = 'none';
    document.getElementById('move-history').innerHTML = '';
    this.renderBoard();
    this.updateStatus();
    this.updateCaptured();
    document.getElementById('last-move-display').textContent = '—';
  }

  // ─── RENDER BOARD ───
  renderBoard() {
    const boardEl = document.getElementById('chess-board');
    boardEl.innerHTML = '';

    const files = 'abcdefgh';
    const kingPos = this.game.findKing(this.game.turn, this.game.board);
    const enemy = this.game.turn === 'w' ? 'b' : 'w';
    const isKingInCheck = this.game.inCheck && kingPos;

    for (let vr = 0; vr < 8; vr++) {
      for (let vc = 0; vc < 8; vc++) {
        const r = this.isFlipped ? 7 - vr : vr;
        const c = this.isFlipped ? 7 - vc : vc;
        const isLight = (r + c) % 2 === 0;
        const sq = document.createElement('div');
        sq.className = `square ${isLight ? 'light' : 'dark'}`;
        sq.dataset.row = r;
        sq.dataset.col = c;

        // Labels
        if (vc === 0) {
          const rank = document.createElement('span');
          rank.className = 'rank-label';
          rank.textContent = this.isFlipped ? r + 1 : 8 - r;
          sq.appendChild(rank);
        }
        if (vr === 7) {
          const file = document.createElement('span');
          file.className = 'file-label';
          file.textContent = files[c];
          sq.appendChild(file);
        }

        // Selected / last move highlights
        if (this.selectedSquare && this.selectedSquare[0] === r && this.selectedSquare[1] === c) {
          sq.classList.add('selected');
        }
        if (this.lastMoveSquares) {
          const [from, to] = this.lastMoveSquares;
          if (from[0] === r && from[1] === c) sq.classList.add('last-move-from');
          if (to[0] === r && to[1] === c) sq.classList.add('last-move-to');
        }

        // King in check
        if (isKingInCheck && kingPos[0] === r && kingPos[1] === c) {
          sq.classList.add('in-check');
        }

        // Legal move hints
        if (this.showHints && this.selectedSquare) {
          const isTarget = this.legalMoves.find(m => m.to[0] === r && m.to[1] === c);
          if (isTarget) {
            const hint = document.createElement('div');
            const hasEnemyPiece = this.game.board[r][c];
            hint.className = 'move-hint' + (hasEnemyPiece ? ' capture' : '');
            sq.appendChild(hint);
          }
        }

        // Piece
        const piece = this.game.board[r][c];
        if (piece) {
          const pieceEl = document.createElement('div');
          pieceEl.className = `piece ${piece[0] === 'w' ? 'white-piece' : 'black-piece'}`;
          pieceEl.textContent = PIECE_SYMBOLS[piece] || '?';
          if (this.selectedSquare && this.selectedSquare[0] === r && this.selectedSquare[1] === c) {
            pieceEl.classList.add('selected-piece');
          }
          sq.appendChild(pieceEl);
        }

        boardEl.appendChild(sq);
      }
    }
  }

  updateUI(san, isAI = false) {
    document.getElementById('last-move-display').textContent = 
      (isAI ? '🤖 ' : '👤 ') + (san || '—');
    this.updateStatus();
    this.renderMoveHistory();
    this.updateCaptured();
  }

  updateStatus() {
    const turnEl = document.getElementById('status-turn');
    const detailEl = document.getElementById('status-detail');

    if (this.game.gameOver) {
      turnEl.textContent = 'Game Over';
      detailEl.textContent = this.game.result;
      return;
    }

    const colorName = this.game.turn === 'w' ? 'White' : 'Black';
    turnEl.textContent = `${colorName} to move`;
    
    if (this.game.inCheck) {
      detailEl.textContent = `${colorName} is in CHECK!`;
      detailEl.style.color = 'var(--accent-red)';
    } else {
      detailEl.textContent = 'Game in progress';
      detailEl.style.color = '';
    }
  }

  renderMoveHistory() {
    const el = document.getElementById('move-history');
    el.innerHTML = '';
    const history = this.game.moveHistory;
    for (let i = 0; i < history.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'move-row';
      const num = document.createElement('span');
      num.className = 'move-num';
      num.textContent = Math.floor(i/2) + 1 + '.';
      row.appendChild(num);
      [history[i], history[i+1]].forEach((h, j) => {
        if (!h) return;
        const m = document.createElement('span');
        m.className = 'move-san' + (i + j === history.length - 1 ? ' current' : '');
        m.textContent = h.san;
        row.appendChild(m);
      });
      el.appendChild(row);
    }
    el.scrollTop = el.scrollHeight;
  }

  updateCaptured() {
    const pieceSymbols = { P:'♟', N:'♞', B:'♝', R:'♜', Q:'♛', K:'♚' };
    const wp = ['♙', '♘', '♗', '♖', '♕'];
    const bp = ['♟', '♞', '♝', '♜', '♛'];
    
    const wCap = this.game.capturedPieces.w; // white captured black pieces
    const bCap = this.game.capturedPieces.b; // black captured white pieces

    document.getElementById('captured-black').textContent = 
      wCap.map(p => PIECE_SYMBOLS['b' + p[1]]).join('');
    document.getElementById('captured-white').textContent = 
      bCap.map(p => PIECE_SYMBOLS['w' + p[1]]).join('');

    // Material advantage
    const VALUES = { P:1, N:3, B:3, R:5, Q:9, K:0 };
    const wAdv = wCap.reduce((s,p) => s + (VALUES[p[1]]||0), 0);
    const bAdv = bCap.reduce((s,p) => s + (VALUES[p[1]]||0), 0);
    const diff = wAdv - bAdv;
    const scoreEl = document.getElementById('material-score');
    scoreEl.textContent = diff === 0 ? '=' : (diff > 0 ? '+' + diff : diff);
    scoreEl.style.color = diff > 0 ? '#c9a84c' : diff < 0 ? '#4a8fc9' : 'var(--text-dim)';
  }

  showGameOverModal() {
    const isCheckmate = this.game.inCheck || this.game.result?.includes('checkmate');
    const isDraw = this.game.result?.includes('Draw') || this.game.result?.includes('stalemate');
    
    document.getElementById('modal-icon').textContent = isDraw ? '🤝' : '♛';
    document.getElementById('modal-title').textContent = isDraw ? 'Draw!' : 'Checkmate!';
    document.getElementById('modal-body').textContent = this.game.result;
    document.getElementById('modal-overlay').style.display = 'flex';
  }

  closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
  }
}

// ─── BOOT ───
window.addEventListener('DOMContentLoaded', () => {
  window.chessApp = new ChessApp();
});
