export {};

import * as Sio from 'socket.io';

const io = Sio();

interface Player {
  name: string;
}

interface Input {
  time: number;
  keys: any;
}

io.on('connection', (socket: SocketIO.Socket) => {
  console.log('client connected');

  socket.on('join', (player: Player) => {
    console.log(`player ${player.name} joined`);

    socket.emit('joined', {world: 'blah'});

    socket.on('input', (input: Input) => {
      console.log(`player ${player.name} sent input for t=${input.time}: ${input.keys}`);
    });

    socket.on('disconnect', () => {
      console.log(`player ${player.name} disconnected`);
    });
  });

});

io.listen(3000);
