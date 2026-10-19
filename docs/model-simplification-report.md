# 100 MiB altında Blender model sadeleştirmesi

Tarih: 19 Ekim 2026. Blender 5.2.1 LTS kullanıldı.

Bu çalışma önceki tam detaylı GLB dönüşümünden sonradır. Güncel dosyalar
`public/models/*.glb` içindedir. Tam detaylı GLB yedekleri
`.artifacts/demo-game/blender-simplification/originals/` klasöründe korunur.
Orijinal FBX dosyaları değiştirilmemiştir.

## Sonuçlar

Hedef GitHub'ın dosya başına 100 MiB sınırıdır: **104,857,600 bayt**.
Arama hedefi bunun 1,024 bayt altıdır. Her aday gerçek GLB olarak dışa
aktarılıp boyutu ölçülmüştür; dosyalara yapay dolgu eklenmemiştir.

| Dosya | Tam detaylı GLB (MiB) | Güncel GLB (MiB) | Üçgenler | Korunan üçgen oranı |
| --- | ---: | ---: | ---: | ---: |
| aldric.glb | 119.9134 | 99.9971 | 2,566,884 → 1,990,840 | 77.559% |
| ayrton.glb | 76.3211 | 76.3211 | 1,261,376 → 1,261,376 | 100.000% |
| daria.glb | 179.6291 | 99.9971 | 4,195,498 → 1,927,272 | 45.937% |
| gideon.glb | 134.8368 | 99.9980 | 2,989,450 → 1,987,738 | 66.492% |
| julius.glb | 157.3023 | 99.9984 | 3,524,172 → 1,881,861 | 53.399% |

Ayrton zaten sınır altında olduğu için tam detaylı sürümü korunmuştur.
Diğer modellerde Blender Decimate / Collapse kullanılmıştır. Bu işlem
geometrik olarak kayıplıdır; tam detaylı yedekler bu yüzden saklanmıştır.

## Doğrulama

- Güncel beş GLB de 100 MiB altındadır.
- Dokular küçültülmemiştir. Sadeleştirilen modellerin kaynak doku kanalları
  çözümlenmiş piksel hash'leriyle karşılaştırılmış, özgün çözünürlükte korunmuştur.
- Draco, Meshopt, gltfpack ve kayıplı doku sıkıştırması uygulanmamıştır.
- Seçilen her GLB Blender'a tekrar alınmış, üçgen sayısı doğrulanmıştır.
- Sadeleştirilen dört modelde geometrik değişim iki yönde, model başına
  10,000'er örnek noktanın karşı yüzeye uzaklığıyla ölçülmüştür.
  Ölçülen en büyük örnek sapması 4.913293e-4 Blender birimidir.
  Bu bir örnekleme ölçümüdür; tüm yüzey için matematiksel üst sınır değildir.
- Her model sitenin gerçek WebGL görüntüleyicisinde açılmış ve ekran görüntüleri
  tam detaylı sürümlerle karşılaştırılmıştır.

Oran arama kayıtları, kaynak/çıktı hash'leri, doku hash'leri ve yüzey sapmaları
`.artifacts/demo-game/blender-simplification/*-report.json` dosyalarındadır.

## Git durumu

Büyük FBX dosyaları yalnızca çalışma klasöründen silinerek yeni bir commit
eklenirse önceki committe kalır ve GitHub gönderimi yine reddeder. Bu yüzden
gönderilmemiş model commiti, büyük FBX'ler yerine sınır altındaki GLB'leri
içerecek şekilde değiştirilmelidir. Tam detaylı yerel yedekler Git'e eklenmez.
