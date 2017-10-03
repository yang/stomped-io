#!/usr/bin/env bash

mkdir -p dist/assets/
for suffix in white aqua yellow green red ; do
  convert assets/player?-$suffix.png \( assets/player?-$suffix.png -flop \) +append dist/assets/player-$suffix.png
done
