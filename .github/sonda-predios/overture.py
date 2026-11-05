# Conta os prédios do Overture (OSM + Microsoft + Google + outros) em volta de cada lugar, por fonte, com e sem altura.
import sys, duckdb, math
rel = sys.argv[1]
L = {'paulista': (-23.565, -46.652), 'campinas': (-22.906, -47.061), 'copacabana': (-22.967, -43.186), 'ribeirao': (-21.214, -47.806), 'sorocaba': (-23.531, -47.468)}
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
for k, (lat, lng) in L.items():
    r = 750; dlat = r / 110574; dlng = r / (111320 * math.cos(math.radians(lat)))
    q = f"""
    SELECT sources[1].dataset AS fonte, count(*) n, count(height) com_altura, count(num_floors) com_andares
    FROM read_parquet('s3://overturemaps-us-west-2/release/{rel}/theme=buildings/type=building/*', hive_partitioning=1)
    WHERE bbox.xmin > {lng - dlng} AND bbox.xmax < {lng + dlng} AND bbox.ymin > {lat - dlat} AND bbox.ymax < {lat + dlat}
    GROUP BY 1 ORDER BY 2 DESC"""
    try:
        rows = con.execute(q).fetchall()
        print(k, 'quadrado 1,5 km:', rows, flush=True)
    except Exception as e:
        print(k, 'erro', e, flush=True)
