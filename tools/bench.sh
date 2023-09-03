#!/bin/bash

# This script is used to benchmark the performance of the
docker exec -it isucon6-qualify-web-1 sh -c 'echo -n > /var/log/nginx/access.log'

# 1. Warm up
cd bench
./bin/bench
