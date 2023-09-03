FROM mysql:8.0

RUN mkdir -p /var/log/mysql
RUN chown mysql:mysql /var/log/mysql

RUN mkdir -p /etc/mysql/conf.d
COPY ./config/my.cnf /etc/mysql/conf.d/my.cnf
