#!/usr/bin/env bash
rsync -rav -e ssh --exclude='node_modules*' . swadmin@192.168.11.88:~/minesine/server/