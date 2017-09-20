export {};

const Sio = require('socket.io');

const io = Sio();
console.log(io.xxx.xxx);

io.on('connection', (socket) => {
  console.log('client connected');

  socket.on('join', (player) => {
    console.log(`player ${player.name} joined`);

    socket.emit('joined', {world: 'blah'});

    socket.on('input', (input) => {
      console.log(`player ${player.name} sent input for t=${input.time}: ${input.keys}`);
    });

    socket.on('disconnect', (data) => {
      console.log(`player ${player.name} disconnected`);
    });
  });

});

io.listen(3000);
