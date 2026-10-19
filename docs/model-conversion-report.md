# Blender FBX → GLB dönüşüm raporu

> Bu rapor ilk, tam detaylı dönüşümü açıklar. Sonraki boyut azaltma çalışması
> [model-simplification-report.md](model-simplification-report.md) içinde raporlanır.
> Tam detaylı GLB yedekleri `.artifacts/demo-game/blender-simplification/originals/`
> klasöründe korunur; `public/models/` içindeki GLB'ler güncel kullanım sürümleridir.

Tarih: 19 Ekim 2026. Yerel Blender **5.2.1 LTS** kullanıldı.
Orijinal FBX dosyaları değiştirilmedi; SHA-256 karşılaştırmasıyla doğrulandı.
Yeni dosyalar `public/models/` içinde orijinallerin yanına kaydedildi.

| Model | FBX (MiB) | GLB (MiB) | Üçgen sayısı (önce = sonra) | GLB < 100 MiB |
| --- | ---: | ---: | ---: | :---: |
| Aldric | 127.60 | 119.91 | 2,566,884 | Hayır |
| Ayrton | 79.38 | 76.32 | 1,261,376 | Evet |
| Daria | 187.32 | 179.63 | 4,195,498 | Hayır |
| Gideon | 143.45 | 134.84 | 2,989,450 | Hayır |
| Julius | 164.38 | 157.30 | 3,524,172 | Hayır |

## Kalitenin korunması

- Poligon azaltma, Decimate, Draco, Meshopt ve gltfpack uygulanmadı.
- Doku boyutları küçültülmedi. Orijinal 4096×4096 ve 2048×2048 boyutlar korundu.
- Her FBX ve GLB yeniden Blender'a aktarıldı. Tüm modellerde üçgen sayıları,
  sınırlar ve UV içeren mesh sayıları eşleşti.
- Nokta konumları iki yönde en yakın nokta karşılaştırmasıyla doğrulandı.
  En büyük fark **8.43 × 10⁻⁸ Blender birimi**; float32 dönüşüm yuvarlaması
  düzeyinde. Bu nedenle dosyalar bit düzeyinde aynı veri olarak tanımlanmıyor.
- Dokular çözümlenerek kanal kanal SHA-256 karşılaştırması yapıldı.
  Beş modelde de tüm kaynak doku kanalları özgün çözünürlükte korundu.
  glTF, metallic/roughness kanallarını paketlediği için dört kaynak görsel
  üç çıktı görselinde saklanıyor; bu, çözünürlük azaltılması değil.
- Kaynak modellerin hiçbirinde iskelet, animasyon veya shape key bulunmuyordu.
- Materyal tanımları FBX'ten glTF/PBR sistemine aktarılıyor; farklı ışık veya
  render motorlarında görünümün bit düzeyinde aynı olması garanti edilmiyor.
- Beş GLB de sitenin gerçek WebGL görüntüleyicisinde ayrı ayrı açıldı ve
  ekran görüntüleri incelendi.

## Tekrarlama ve ayrıntılar

`scripts/convert-character-models.py`, Blender'ın arka plan modunda çalışır.
Var olan FBX veya GLB dosyalarının üzerine yazmaz.

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' `
  --background --factory-startup --disable-autoexec --python-exit-code 1 `
  --python scripts/convert-character-models.py -- `
  --model character.fbx --work-dir .artifacts/demo-game/blender-conversion
```

Ayrıntılı model raporları, doku kanal hash'leri ve görüntüleyici ekran
görüntüleri `.artifacts/demo-game/blender-conversion/` klasöründe yereldedir.

## GitHub gönderimi

Yalnızca format dönüşümü dört büyük modeli 100 MiB altına indirmedi.
Yeni GLB dosyalarının oluşturulması, önceki committe bulunan büyük FBX
dosyalarını veya Git geçmişini değiştirmedi. Bu dosyalar için ek boyut
azaltma veya büyük dosya barındırması gerekiyor; bu çalışma commit/push yapmadı.
