
FROM oven/bun AS isudabuilder

RUN apt-get update
WORKDIR /app
COPY ./webapp/js/isuda/package.json /app/package.json
RUN bun install

FROM oven/bun AS isuda
WORKDIR /app
COPY ./webapp/js/isuda /app
COPY --from=isudabuilder /app/node_modules /app/node_modules

CMD 'bun' 'run' 'start'
