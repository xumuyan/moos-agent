#!/bin/bash
umask 077
export HOME=/Users/xuguopeng
export TMPDIR=/private/tmp/
export PATH=/Users/xuguopeng/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin:/usr/sbin:/sbin
cd /Applications/.moos-update-0.1.33 || exit 1
node update.mjs > terminal-update.log 2>&1
