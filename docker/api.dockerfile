# node 
FROM oven/bun AS builder

RUN apt-get update

WORKDIR /app
COPY ./webapp/js/package.json /app/package.json
RUN bun install

FROM oven/bun AS isutarbuilder

RUN apt-get update
WORKDIR /app
COPY ./webapp/js/istar/package.json /app/package.json
RUN bun install

FROM node:20 AS isuda
WORKDIR /app
COPY ./webapp/js /app
COPY ./webapp/public /app/public
COPY --from=builder /app/node_modules /app/node_modules

CMD 'yarn' 'isuda'

FROM oven/bun AS isutar
WORKDIR /app
COPY ./webapp/js/istar /app
COPY --from=isutarbuilder /app/node_modules /app/node_modules

CMD 'bun' 'run' 'start'
