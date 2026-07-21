FROM clickhouse/clickhouse-server:25.3.2

ADD ./ /docker-entrypoint-initdb.d/
ADD ./test_prod_dumps/ /var/lib/clickhouse/user_files/test_prod_dumps/