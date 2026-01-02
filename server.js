const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static('public'));

// rooms[roomID] = { 
//    players: { socketId: { ... } }, 
//    gameState: 'WAITING', 
//    pipeInterval: null  <-- Mới: Dùng để server tự sinh cột
// }
let rooms = {}; 

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // TẠO PHÒNG
    socket.on('create_room', (data) => {
        let roomId = Math.random().toString(36).substring(2, 7).toUpperCase(); 
        rooms[roomId] = {
            players: {},
            gameState: "WAITING",
            pipeInterval: null 
        };
        joinRoomLogic(socket, roomId, data.name);
        socket.emit('room_created', roomId);
    });

    // VÀO PHÒNG
    socket.on('join_room', (data) => {
        const { roomId, name } = data;
        if (rooms[roomId]) {
            if (Object.keys(rooms[roomId].players).length >= 4) {
                socket.emit('error_message', 'Phòng đã đầy (Max 4)!');
                return;
            }
            if (rooms[roomId].gameState === "PLAYING") {
                socket.emit('error_message', 'Game đang diễn ra, không thể vào!');
                return;
            }
            joinRoomLogic(socket, roomId, name);
        } else {
            socket.emit('error_message', 'Không tìm thấy phòng!');
        }
    });

    function joinRoomLogic(socket, roomId, name) {
        socket.join(roomId);
        rooms[roomId].players[socket.id] = {
            id: socket.id,
            name: name,
            x: 0, y: 0, rotation: 0, score: 0, isDead: false
        };
        io.to(roomId).emit('update_players', rooms[roomId].players);
    }

    // BẮT ĐẦU GAME
    socket.on('start_game_request', (roomId) => {
        if(rooms[roomId]) {
            rooms[roomId].gameState = "PLAYING";
            
            // Reset trạng thái tất cả người chơi
            for (let pid in rooms[roomId].players) {
                rooms[roomId].players[pid].isDead = false;
                rooms[roomId].players[pid].score = 0;
            }

            // Gửi lệnh bắt đầu
            io.to(roomId).emit('game_started');

            // --- SERVER SINH CỘT (MAP ĐỒNG BỘ) ---
            if (rooms[roomId].pipeInterval) clearInterval(rooms[roomId].pipeInterval);
            
            // Đợi 3s countdown rồi mới bắt đầu thả cột
            setTimeout(() => {
                // Kiểm tra lại phòng còn tồn tại và game còn đang chơi không
                if (rooms[roomId] && rooms[roomId].gameState === "PLAYING") {
                    rooms[roomId].pipeInterval = setInterval(() => {
                        if (!rooms[roomId]) return;

                        // Tính toán độ cao cột ngẫu nhiên TẠI SERVER
                        let pipeHeight = 512;
                        let randomY = 0 - pipeHeight/4 - Math.random()*(pipeHeight/2.5);
                        
                        // Gửi tọa độ Y này cho TẤT CẢ người chơi
                        io.to(roomId).emit('spawn_pipe', randomY);
                    }, 1600); // 1.6 giây ra 1 cột
                }
            }, 3000);
        }
    });

    // CẬP NHẬT VỊ TRÍ
    socket.on('update_position', (data) => {
        if (rooms[data.roomId] && rooms[data.roomId].players[socket.id]) {
            let p = rooms[data.roomId].players[socket.id];
            p.y = data.y;
            p.rotation = data.rotation;
            p.score = data.score;
            socket.to(data.roomId).emit('player_moved', p);
        }
    });

    // XỬ LÝ KHI NGƯỜI CHƠI CHẾT
    socket.on('player_died', (roomId) => {
        if (rooms[roomId] && rooms[roomId].players[socket.id]) {
            rooms[roomId].players[socket.id].isDead = true;
            // score đã được update liên tục ở trên, lấy giá trị hiện tại làm điểm chốt
            
            io.to(roomId).emit('player_status_update', { id: socket.id, isDead: true });

            // Kiểm tra xem TẤT CẢ đã chết chưa?
            let allDead = true;
            let ranking = [];
            for (let pid in rooms[roomId].players) {
                if (!rooms[roomId].players[pid].isDead) {
                    allDead = false;
                }
                ranking.push(rooms[roomId].players[pid]);
            }

            if (allDead) {
                // Dừng sinh cột ngay
                if(rooms[roomId].pipeInterval) clearInterval(rooms[roomId].pipeInterval);
                rooms[roomId].gameState = "GAMEOVER";
                
                // Sắp xếp điểm từ cao xuống thấp
                ranking.sort((a, b) => b.score - a.score);
                
                // Gửi bảng thành tích cho cả phòng
                io.to(roomId).emit('show_leaderboard', ranking);
            }
        }
    });

    // NGẮT KẾT NỐI
    socket.on('disconnect', () => {
        for (let roomId in rooms) {
            if (rooms[roomId].players[socket.id]) {
                delete rooms[roomId].players[socket.id];
                io.to(roomId).emit('update_players', rooms[roomId].players);
                
                // Nếu phòng trống thì xóa phòng
                if (Object.keys(rooms[roomId].players).length === 0) {
                    if(rooms[roomId].pipeInterval) clearInterval(rooms[roomId].pipeInterval);
                    delete rooms[roomId];
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});