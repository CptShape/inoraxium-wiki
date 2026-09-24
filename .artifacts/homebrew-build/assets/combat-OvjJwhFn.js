const a=`## Initiative\r
DEX check ile her karakterin savaş sıralamasında ki konumu belirlenir.\r
Ambush: Savaşa hazırlıksız yakalanan karakterler initiative zarına dezavantaj alır.\r
\r
## Ending Combat\r
Geriye savaşabilecek tek bir taraf kalınca savaş sonlanır. Karakterlerin savaşamayacak duruma düşmesi için: ölmesi, bayılması, teslim olması veya kaçmış olması gerekir.\r
\r
## Cover\r
Cover arkasında saklanmak, vurulmayı zorlaştırır. Yarı cover, +2 AC. Büyük cover, +5 AC. Tam cover ise hedeflenmeyi engeller.\r
\r
## Hit\r
Saldırı zarlarında zar sonucu maksimum değer gelirse kritik hasar (aksi yazmadığı sürece 2 kat hasar), zar sonucu minimum değer gelirse otomatik ıskadır.\r
\r
## HP\r
Bir karakterin canı, ırkının base HP değerine, CON Modifier'ına, level'ına ve sahip olduğu eşyalar/özelliklere bağlıdır.\r
\r
### Healing\r
Can doldurma yolları: Büyü, İksir ve Dinlenmektir. Can, maximum canı geçemez.\r
\r
### Armor\r
Bir karakterin Armor'u varken hasar önce armordan azaltılır.\r
\r
### Death\r
Canı 0'a düşen karakterler "ölüm eşiğinde" durumuna gelir. Bu durumda iken her tur death saving throw atılır. 3 başarılı yada 3 başarısız olunca durum sona erer. Can 0'a düştüğünde artan hasarın miktarına göre karakter bir kaç başarısız death saving throw ile başlayabilir. 3 başarısız: ölüm. 3 başarılı: geri kalkar. Canı 0'a düşen birini öldürmek yerine bayıltmayı seçerek bayıltılabilir, uyanınca short rest etkisi alır. ölüm eşiğindeki biri başkası tarafından kaldırılabilir.\r
\r
## Rest\r
Dinlenme çeşitleri aşağıdaki gibidir.\r
\r
### Short Rest\r
1 saat sürer. Yemek yiyip hafif dinlenme sonucu yapılabilir. %(1d20+20) kadar heal verir.\r
\r
### Long Rest\r
8 saat uyku. %100 heal.`;export{a as default};
